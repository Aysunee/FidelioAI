const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const db = require('./db.cjs');

const app = express();
const server = http.createServer(app);

// Enable CORS for frontend connection
app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(bodyParser.json());

const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for socket.io
        methods: ["GET", "POST"]
    }
});

// Helper: Load signals from MySQL
const loadSignals = async () => {
    try {
        const [rows] = await db.query('SELECT * FROM signals ORDER BY time DESC LIMIT 1000');
        return rows;
    } catch (error) {
        console.error('Error loading signals from DB:', error);
        return [];
    }
};

// Helper: Save signal to MySQL
const saveSignal = async (signal) => {
    try {
        const query = `
            INSERT INTO signals (id, strategy, symbol, side, price, time, note, source, confidence)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const values = [
            signal.id,
            signal.strategy,
            signal.symbol,
            signal.side,
            signal.price,
            signal.time,
            signal.note,
            signal.source,
            signal.confidence
        ];
        await db.query(query, values);
        return true;
    } catch (error) {
        console.error('Error saving signal to DB:', error);
        return false;
    }
};

// User Database Helpers
const loadUsers = async () => {
    try {
        const [rows] = await db.query('SELECT * FROM users');
        // Parse permissions if stored as string
        return rows.map(user => ({
            ...user,
            permissions: typeof user.permissions === 'string' ? JSON.parse(user.permissions || '[]') : user.permissions
        }));
    } catch (error) {
        console.error('Error loading users DB:', error);
        return [];
    }
};

const findUserById = async (id) => {
    try {
        const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        const user = rows[0];
        // Parse permissions
        user.permissions = typeof user.permissions === 'string' ? JSON.parse(user.permissions || '[]') : user.permissions;
        return user;
    } catch (error) {
        console.error('Error finding user:', error);
        return null;
    }
};

const findUserByUsername = async (username) => {
    try {
        const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) return null;
        const user = rows[0];
        user.permissions = typeof user.permissions === 'string' ? JSON.parse(user.permissions || '[]') : user.permissions;
        return user;
    } catch (error) {
        console.error('Error finding user by username:', error);
        return null;
    }
}


// ... inside webhook endpoint ...

// Get Signals (Database)
app.get('/api/signals', async (req, res) => {
    const signals = await loadSignals();
    res.json(signals);
});

// Webhook Endpoint
app.post('/api/webhook', async (req, res) => {
    const data = req.body;
    console.log('Webhook received:', data);

    // Basic Validation
    if (!data.symbol || !data.side || !data.price) {
        return res.status(400).json({ error: 'Missing required fields: symbol, side, price' });
    }

    // Create Signal Object (Respect existing fields if provided)
    const signal = {
        id: data.id || `wh_${Date.now()}`,
        strategy: data.strategy || 'External_Webhook',
        symbol: data.symbol.toUpperCase(),
        side: data.side.toUpperCase(),
        price: parseFloat(data.price),
        time: data.time || new Date().toISOString(),
        note: data.note || 'Received via Webhook',
        source: data.source || 'WEBHOOK',
        confidence: data.confidence || 0.95
    };

    // Save to DB
    await saveSignal(signal);

    // Broadcast to frontend
    io.emit('new_signal', signal);

    return res.status(200).json({ success: true, signalId: signal.id });
});

// User Management API Endpoints

// Get all users
app.get('/api/users', async (req, res) => {
    const users = await loadUsers();
    res.json(users);
});

// Get single user by ID
app.get('/api/users/:id', async (req, res) => {
    const user = await findUserById(req.params.id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
});

// Create new user
app.post('/api/users', async (req, res) => {
    const { email, name, username, password, role, permissions } = req.body;

    // Validation
    if (!email || !name || !username || !password || !role) {
        return res.status(400).json({ error: 'Missing required fields: email, name, username, password, role' });
    }

    try {
        // Check for duplicate email or username
        const [emailCheck] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (emailCheck.length > 0) {
            return res.status(400).json({ error: 'Email already exists' });
        }

        const [usernameCheck] = await db.query('SELECT id FROM users WHERE username = ?', [username]);
        if (usernameCheck.length > 0) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        const newUser = {
            id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            email,
            name,
            username,
            password, // In production, this should be hashed
            role,
            status: 'active',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            permissions: permissions || [],
            lastLogin: null
        };

        const query = `
            INSERT INTO users (id, email, name, username, password, role, status, created_at, updated_at, permissions, last_login)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        await db.query(query, [
            newUser.id,
            newUser.email,
            newUser.name,
            newUser.username,
            newUser.password,
            newUser.role,
            newUser.status,
            newUser.createdAt,
            newUser.updatedAt,
            JSON.stringify(newUser.permissions),
            newUser.lastLogin
        ]);

        // Don't send password back in response
        const { password: _, ...userResponse } = newUser;
        res.status(201).json(userResponse);
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update user
app.put('/api/users/:id', async (req, res) => {
    const userId = req.params.id;
    const { email, name, username, password, role, status, permissions } = req.body;

    try {
        const user = await findUserById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check for duplicate email or username (excluding current user)
        if (email) {
            const [emailCheck] = await db.query('SELECT id FROM users WHERE email = ? AND id != ?', [email, userId]);
            if (emailCheck.length > 0) return res.status(400).json({ error: 'Email already exists' });
        }
        if (username) {
            const [usernameCheck] = await db.query('SELECT id FROM users WHERE username = ? AND id != ?', [username, userId]);
            if (usernameCheck.length > 0) return res.status(400).json({ error: 'Username already exists' });
        }

        // Build update query dynamically
        const updates = [];
        const values = [];

        if (email) { updates.push('email = ?'); values.push(email); }
        if (name) { updates.push('name = ?'); values.push(name); }
        if (username) { updates.push('username = ?'); values.push(username); }
        if (password) { updates.push('password = ?'); values.push(password); }
        if (role) { updates.push('role = ?'); values.push(role); }
        if (status) { updates.push('status = ?'); values.push(status); }
        if (permissions) { updates.push('permissions = ?'); values.push(JSON.stringify(permissions)); }

        updates.push('updated_at = ?');
        values.push(Date.now());

        if (updates.length > 0) {
            const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
            values.push(userId);
            await db.query(query, values);
        }

        const updatedUser = await findUserById(userId);
        const { password: _, ...userResponse } = updatedUser;
        res.json(userResponse);

    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete user
app.delete('/api/users/:id', async (req, res) => {
    try {
        const [result] = await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ success: true, message: 'User deleted' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get user activity (placeholder - would need separate activity tracking)
app.get('/api/users/:id/activity', async (req, res) => {
    const user = await findUserById(req.params.id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    // Placeholder - return empty activity for now
    res.json([]);
});

// Login Authentication Endpoint
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    try {
        const [rows] = await db.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password]);

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const user = rows[0];

        if (user.status !== 'active') {
            return res.status(403).json({ error: 'Account is inactive' });
        }

        // Update last login
        await db.query('UPDATE users SET last_login = ? WHERE id = ?', [Date.now(), user.id]);

        // Return user data without password
        const { password: _, ...userResponse } = user;
        // Parse permissions
        userResponse.permissions = typeof user.permissions === 'string' ? JSON.parse(user.permissions || '[]') : user.permissions;

        res.json({
            success: true,
            user: userResponse
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});



// Proxy Endpoint (Bypass CORS for Telegram/Discord)
app.post('/api/forward', async (req, res) => {
    try {
        const { url, method = 'POST', headers = {}, body } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'Target URL is required' });
        }

        console.log(`🔀 Proxying request to: ${url}`);

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers
            },
            body: body ? JSON.stringify(body) : undefined
        });

        const data = await response.json();
        return res.status(response.status).json(data);

    } catch (error) {
        console.error('Proxy Error:', error);
        return res.status(500).json({ error: 'Proxy request failed', details: error.message });
    }
});

// AI Analysis Endpoint
const { GoogleGenAI } = require("@google/genai");
let ai;
if (process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
} else {
    console.warn("⚠️ GEMINI_API_KEY is not set. AI analysis features will be disabled.");
}

app.post('/api/analyze', async (req, res) => {
    try {
        if (!ai) {
            return res.status(503).json({ error: "AI service unavailable (Missing API Key)" });
        }
        const { prompt, context } = req.body;

        const systemInstruction = `You are Fidelio, an elite crypto market intelligence analyst. 
        Your persona is professional, concise, and data-driven. You speak like a senior trader at a hedge fund.
        You have access to real-time market data provided in the context.
        ALWAYS use the Google Search tool to verify breaking news, macro events, or reasons for sudden price moves.
        When analyzing, combine the technical data provided with the search results.
        Format your responses using Markdown. Use bullet points for readability.
        If you use Google Search, ensure you integrate the findings into your analysis.`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                { role: 'user', parts: [{ text: `[MARKET CONTEXT]\n${context}\n\n[USER QUERY]\n${prompt}` }] }
            ],
            config: {
                systemInstruction: systemInstruction,
                tools: [{ googleSearch: {} }],
                temperature: 0.7,
            },
        });

        const text = response.text || "No analysis generated.";

        // Extract sources
        const sources = [];
        const candidate = response.candidates?.[0];
        if (candidate?.groundingMetadata?.groundingChunks) {
            candidate.groundingMetadata.groundingChunks.forEach((chunk) => {
                if (chunk.web) {
                    sources.push({
                        title: chunk.web.title || 'Source',
                        uri: chunk.web.uri
                    });
                }
            });
        }

        res.json({ text, sources });

    } catch (error) {
        console.error("AI Error:", error);
        res.status(500).json({ error: "Analysis failed", details: error.message });
    }
});

// Health Check Endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Webhook Server running on http://0.0.0.0:${PORT}`);
    console.log(`👉 Webhook Endpoint: http://0.0.0.0:${PORT}/api/webhook`);
});
