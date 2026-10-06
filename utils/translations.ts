export type Language = 'en' | 'tr';

export const translations = {
    en: {
        // Navigation
        markets: 'Markets',
        spotSniper: 'Spot Sniper',
        derivatives: 'Derivatives',
        radar: 'Radar',
        portfolio: 'Portfolio',
        signals: 'Signals',
        nexus: 'Nexus',
        fidelioAi: 'Fidelio.ai',
        journal: 'Journal',
        database: 'Database',
        lab: 'Lab',

        // Header/Settings
        preferences: 'Preferences',
        language: 'Language',
        turkish: 'Turkish',
        english: 'English',
        connected: 'Connected',
        connecting: 'Connecting...',
        dataStale: 'Data delayed',
        disconnected: 'Disconnected',
        logout: 'Logout',

        // Overview/Sections
        derivativesOverview: 'Derivatives Overview',
        derivativesDesc: 'Real-time funding rates and next settlement timers.',
        marketAnomalyRadar: 'Market Anomaly Radar',
        radarDesc: 'Live lists of coins that currently meet simple 24h conditions: a move against BTC, negative funding while the price is up, a gain well above BTC, and funding that is changing fast.',
        portfolioTracker: 'Portfolio Tracker',
        portfolioDesc: 'Track assets and log trade history.',

        // Modals
        scalperShortcuts: 'Scalper Shortcuts',
        navigation: 'Navigation',
        actions: 'Actions',
        close: 'Close',

        // Misc
        vibrant: 'Vibrant',
        minimal: 'Minimal',
        switchVibrant: 'Switch to Vibrant Mode',
        switchMinimal: 'Switch to Minimal Mode',

        // Landing Page
        liveIntelligence: 'Live Market Intelligence',
        tradeWith: 'Trade with',
        precision: 'Precision',
        heroDesc: 'Institutional-grade AI signals, real-time anomaly detection, and advanced derivatives analysis—all in one premium interface.',
        startTrading: 'Start Trading',
        exploreFeatures: 'Explore Features',
        builtFor: 'Built for',
        professionals: 'Professionals',
        featuresDesc: 'Advanced tools designed to give you the edge in volatile markets',
        readyToDominate: 'Ready to dominate',
        theMarkets: 'the markets?',
        experienceIntelligence: 'Experience institutional-grade trading intelligence today',
        platform: 'Platform',
        company: 'Company',
        legal: 'Legal',
        allRightsReserved: 'All rights reserved.',

        // Feature Titles/Descs
        featAiTitle: 'AI Pattern Recognition',
        featAiDesc: 'Rule-based pattern scanner flags bull flags, bear flags and other chart formations on Binance candles.',
        featAnomalyTitle: 'Real-Time Anomaly Detection',
        featAnomalyDesc: 'Instant alerts for funding divergences, volume/price pumps and BTC decoupling across Binance spot and perpetual markets.',
        featFundingTitle: 'Funding Rate Intelligence',
        featFundingDesc: 'Funding rates of Binance USDT-M perpetuals as 8h equivalents, with the 1h slope and the contracts currently in the negative extreme.',
        featChartTitle: 'Multi-Chart Command Center',
        featChartDesc: 'Professional-grade charting with synchronized analysis, custom indicators, and institutional tools.',
        featVolumeTitle: 'Volume Spike Alerts',
        featVolumeDesc: 'Records when the last hour of spot volume exceeds a multiple of the 24h hourly average (Binance rolling 1h ticker).',
        featSignalTitle: 'Signal Engine',
        featSignalDesc: 'Three measured rules (24h momentum at a fresh extreme, 1h volume ratio, negative funding regime) that record events; no forecasts.',

        // Login Modal
        welcomeBack: 'Welcome Back',
        enterSystem: 'Enter System',

        // Notification Settings
        notificationSettings: 'Notification Settings',
        soundAlerts: 'Sound Alerts',
        soundDesc: 'Play beep sounds for notifications',
        browserNotifications: 'Browser Notifications',
        browserDesc: 'Show desktop notifications',
        bigMoveAlerts: 'Big Move Alerts',
        bigMoveDesc: 'Notify on significant price movements',
        signalAlerts: 'Signal Alerts',
        signalDesc: 'Notify on 24h momentum, volume ratio and negative funding regime records',
        minPriority: 'Minimum Priority Level',
        priorityDesc: 'Only notify for signals at or above this priority level',
        telegramAlerts: 'Telegram Alerts',
        telegramDesc: 'Receive signals on your mobile',
        botToken: 'Bot Token',
        chatId: 'Chat ID',
        testConnection: 'Test Connection',
        howToConnect: 'How to Connect?',
        soundPriorityLevels: 'Sound Priority Levels',
    },
    tr: {
        // Navigation
        markets: 'Piyasalar',
        spotSniper: 'Spot Sniper',
        derivatives: 'Türev Araçlar',
        radar: 'Radar',
        portfolio: 'Portföy',
        signals: 'Sinyaller',
        nexus: 'Nexus',
        fidelioAi: 'Fidelio.ai',
        journal: 'Günlük',
        database: 'Veritabanı',
        lab: 'Laboratuvar',

        // Header/Settings
        preferences: 'Ayarlar',
        language: 'Dil',
        turkish: 'Türkçe',
        english: 'İngilizce',
        connected: 'Bağlı',
        connecting: 'Bağlanıyor...',
        dataStale: 'Veri gecikiyor',
        disconnected: 'Bağlantı kesildi',
        logout: 'Çıkış Yap',

        // Overview/Sections
        derivativesOverview: 'Türev Piyasası Özeti',
        derivativesDesc: 'Gerçek zamanlı fonlama oranları ve bir sonraki ödeme zamanlayıcıları.',
        marketAnomalyRadar: 'Piyasa Anomali Radarı',
        radarDesc: 'Şu an basit 24s koşulları sağlayan coinlerin canlı listeleri: BTC\'ye ters hareket, fiyat yükselirken negatif fonlama, BTC\'nin belirgin üzerinde 24s getiri ve hızla değişen fonlama.',
        portfolioTracker: 'Portföy Takipçisi',
        portfolioDesc: 'Varlıkları takip edin ve işlem geçmişini kaydedin.',

        // Modals
        scalperShortcuts: 'Scalper Kısayolları',
        navigation: 'Navigasyon',
        actions: 'Eylemler',
        close: 'Kapat',

        // Misc
        vibrant: 'Canlı',
        minimal: 'Minimal',
        switchVibrant: 'Canlı Moda Geç',
        switchMinimal: 'Minimal Moda Geç',

        // Landing Page
        liveIntelligence: 'Canlı Piyasa İstihbaratı',
        tradeWith: 'İle İşlem Yap',
        precision: 'Hassasiyet',
        heroDesc: 'Kurumsal düzeyde yapay zeka sinyalleri, gerçek zamanlı anomali tespiti ve gelişmiş türev analizi—hepsi bir arada premium arayüzde.',
        startTrading: 'İşleme Başla',
        exploreFeatures: 'Özellikleri Keşfet',
        builtFor: 'İçin Tasarlandı',
        professionals: 'Profesyoneller',
        featuresDesc: 'Değişken piyasalarda size avantaj sağlamak için tasarlanmış gelişmiş araçlar',
        readyToDominate: 'Hükmetmeye hazır mısın',
        theMarkets: 'piyasalara?',
        experienceIntelligence: 'Kurumsal düzeyde ticaret istihbaratını bugün deneyimleyin',
        platform: 'Platform',
        company: 'Şirket',
        legal: 'Yasal',
        allRightsReserved: 'Tüm hakları saklıdır.',

        // Feature Titles/Descs
        featAiTitle: 'YZ Formasyon Tanıma',
        featAiDesc: 'Kural tabanlı formasyon tarayıcı; Binance mumlarında boğa bayrağı, ayı bayrağı ve diğer grafik formasyonlarını işaretler.',
        featAnomalyTitle: 'Gerçek Zamanlı Anomali Tespiti',
        featAnomalyDesc: 'Binance spot ve vadeli piyasalarında fonlama uyumsuzluğu, hacimli fiyat sıçraması ve BTC’den ayrışma için anlık uyarılar.',
        featFundingTitle: 'Fonlama Oranı İstihbaratı',
        featFundingDesc: 'Binance USDT-M perp kontratlarının fonlama oranları 8 saatlik eşdeğer olarak; son 1 saatin eğimi ve şu an negatif uçta olan kontratlar.',
        featChartTitle: 'Çoklu Grafik Komuta Merkezi',
        featChartDesc: 'Senkronize analiz, özel göstergeler ve kurumsal araçlarla profesyonel düzeyde grafik oluşturma.',
        featVolumeTitle: 'Hacim Artışı Uyarıları',
        featVolumeDesc: 'Son 1 saatin spot hacmi 24 saatlik ortalama saatin belirli bir katını aştığında kayıt açar (Binance kayan 1 saatlik ticker).',
        featSignalTitle: 'Sinyal Motoru',
        featSignalDesc: 'Üç ölçülen kural (yeni 24s uçta momentum, 1 saatlik hacim oranı, negatif fonlama rejimi) olay kaydeder; tahmin üretmez.',

        // Login Modal
        welcomeBack: 'Tekrar Hoş Geldiniz',
        enterSystem: 'Sisteme Giriş Yap',

        // Notification Settings
        notificationSettings: 'Bildirim Ayarları',
        soundAlerts: 'Sesli Uyarılar',
        soundDesc: 'Bildirimler için ses çal',
        browserNotifications: 'Tarayıcı Bildirimleri',
        browserDesc: 'Masaüstü bildirimlerini göster',
        bigMoveAlerts: 'Büyük Hareket Uyarıları',
        bigMoveDesc: 'Önemli fiyat hareketlerinde bildir',
        signalAlerts: 'Sinyal Uyarıları',
        signalDesc: '24s momentum, hacim oranı ve negatif fonlama rejimi kayıtlarında bildir',
        minPriority: 'Minimum Öncelik Seviyesi',
        priorityDesc: 'Yalnızca bu seviye ve üzerindeki sinyaller için bildir',
        telegramAlerts: 'Telegram Uyarıları',
        telegramDesc: 'Sinyalleri mobilde alın',
        botToken: 'Bot Token',
        chatId: 'Chat ID',
        testConnection: 'Bağlantıyı Test Et',
        howToConnect: 'Nasıl Bağlanılır?',
        soundPriorityLevels: 'Ses Öncelik Seviyeleri',
    }
};

export type TranslationKey = keyof typeof translations.en;
