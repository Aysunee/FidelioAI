// Minimal typing of the `ws` client API used by engine/stream.ts (no @types/ws dependency needed).
declare module 'ws' {
    import { EventEmitter } from 'events';

    interface ClientOptions {
        handshakeTimeout?: number;
        perMessageDeflate?: boolean;
        headers?: Record<string, string>;
    }

    class WebSocket extends EventEmitter {
        constructor(address: string, options?: ClientOptions);
        static readonly OPEN: number;
        readonly readyState: number;
        terminate(): void;
        close(code?: number, reason?: string): void;
    }

    export default WebSocket;
}
