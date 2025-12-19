// Load environment variables from .env file (for local development)
require('dotenv').config({ path: __dirname + '/.env' });

const express = require('express');
const { Chess } = require('chess.js');
const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');
const cors = require('cors');
const QRCode = require('qrcode');
const https = require('https');
const { Ratelimit } = require('@upstash/ratelimit');
const { Redis: UpstashRedis } = require('@upstash/redis');
const { randomUUID } = require('crypto');
const pino = require('pino');
const pinoHttp = require('pino-http');
const Sentry = require('@sentry/node');

const TRMNLP_CONFIG_PATH = path.join(__dirname, '../../trmnl_chess/.trmnlp.yml');
const SITE_DIR = path.join(__dirname, '../site');
// Environment detection
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || process.env.VERCEL;

// Structured logger
const logger = pino({
    level: process.env.LOG_LEVEL || (IS_PRODUCTION ? 'info' : 'debug'),
    transport: IS_PRODUCTION ? undefined : { target: 'pino-pretty', options: { translateTime: true } }
});

function touchTrmnlpConfig() {
    if (IS_PRODUCTION) return;
    try {
        const now = new Date();
        if (fs.existsSync(TRMNLP_CONFIG_PATH)) {
            fs.utimesSync(TRMNLP_CONFIG_PATH, now, now);
            logger.info({ file: TRMNLP_CONFIG_PATH }, 'Touched .trmnlp.yml to nudge local preview');
        }
    } catch (err) {
        logger.warn({ err }, 'Failed to touch .trmnlp.yml');
    }
}

// Sentry (optional)
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
        tracesSampleRate: IS_PRODUCTION ? 0.1 : 0.0,
    });
    logger.info('Sentry initialized');
} else {
    logger.debug('Sentry not configured (SENTRY_DSN missing)');
}

// --- Env validation ---
function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

const HAS_UPSTASH_REST = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

// Connect to Redis (prefer Upstash REST for Vercel serverless; fallback to ioredis for local/dev)
let redis;
if (HAS_UPSTASH_REST) {
    redis = UpstashRedis.fromEnv();
    logger.info('Using Upstash REST Redis client');
} else {
    const redisUrl = requireEnv('UPSTASH_REDIS_URL');
    redis = new Redis(redisUrl);
    logger.info('Using ioredis Redis client');
}

// Rate limiting setup (using Upstash Redis REST for serverless compatibility)
// Reuse REST client when available; fall back to in-memory limiter in development
let upstashRedis;
try {
    upstashRedis = UpstashRedis.fromEnv();
} catch (err) {
    if (HAS_UPSTASH_REST) {
        throw err;
    }
    logger.warn({ err }, 'Upstash REST env missing; using in-memory rate limiter');
}

// Rate limiters for different endpoint types
function createMemoryLimiter(limit, windowMs) {
    const buckets = new Map();
    return {
        async limit(identifier) {
            const now = Date.now();
            const bucket = buckets.get(identifier) || [];
            const recent = bucket.filter(ts => now - ts < windowMs);
            recent.push(now);
            buckets.set(identifier, recent);
            const remaining = Math.max(0, limit - recent.length);
            return {
                success: recent.length <= limit,
                limit,
                remaining,
                reset: now + windowMs
            };
        }
    };
}

const makeLimiter = (key, count, window) => {
    if (upstashRedis) {
        return new Ratelimit({
            redis: upstashRedis,
            limiter: Ratelimit.slidingWindow(count, window),
            analytics: true,
            prefix: `ratelimit:${key}`,
        });
    }
    return createMemoryLimiter(count, (() => {
        const [num, unit] = window.split(' ');
        const n = parseInt(num, 10);
        const ms = unit === 'm' ? 60000 : unit === 'h' ? 3600000 : 1000;
        return n * ms;
    })());
};

const rateLimiters = {
    // Game creation: 10 games per hour per IP (prevent spam)
    createGame: makeLimiter('create_game', IS_PRODUCTION ? 10 : 1000, '1 h'),

    // Moves: 60 moves per minute per IP (allow for quick games)
    makeMove: makeLimiter('make_move', IS_PRODUCTION ? 60 : 1000, '1 m'),

    // Game actions (resign/undo): 20 per minute per IP
    gameAction: makeLimiter('game_action', IS_PRODUCTION ? 20 : 1000, '1 m'),

    // TRMNL polling: 100 per minute (very generous - TRMNL polls every 15s = 4/min)
    polling: makeLimiter('polling', IS_PRODUCTION ? 100 : 10000, '1 m'),
};

// Frontend URL for QR code generation (different in dev vs production)
const FRONTEND_URL = process.env.FRONTEND_URL || (IS_PRODUCTION ? 'https://trmnl-chess.vercel.app' : 'http://localhost:8000');
if (IS_PRODUCTION && !process.env.FRONTEND_URL) {
    logger.warn('FRONTEND_URL not set; defaulting to https://trmnl-chess.vercel.app – update env for correct QR codes');
}

const app = express();
const port = process.env.PORT || 3000;

// Disable ETag to avoid intermediary/device caching dynamic state responses
app.disable('etag');

if (process.env.SENTRY_DSN) {
    app.use(Sentry.Handlers.requestHandler());
}

// Request logging with request IDs
app.use(pinoHttp({
    logger,
    genReqId: () => randomUUID(),
}));

// CORS Configuration
// In production: restrict to specific domains
// In development: allow localhost variants for testing
const allowedOrigins = IS_PRODUCTION
    ? [
        process.env.FRONTEND_URL || 'https://trmnl-chess.vercel.app',
        'https://trmnl-chess.vercel.app' // Fallback
      ]
    : [
        'http://localhost:8000',
        'http://localhost:4567',
        'http://localhost:3000',
        /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:\d{4,5}$/ // Local network IPs
      ];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        // Check if origin matches allowed patterns
        const isAllowed = allowedOrigins.some(allowed => {
            if (typeof allowed === 'string') {
                return origin === allowed;
            } else if (allowed instanceof RegExp) {
                return allowed.test(origin);
            }
            return false;
        });

        if (isAllowed) {
            callback(null, true);
        } else {
            logger.warn({ origin }, 'CORS blocked origin');
            callback(new Error('Not allowed by CORS'));
        }
    }
}));
app.use(express.json());
app.use(express.static(SITE_DIR));

// --- Helper functions to manage the current game ID ---
const GAME_ID_FILE_PATH = path.join(__dirname, '../../trmnl_chess/CURRENT_GAME.id');
const REDIS_CURRENT_GAME_KEY = 'trmnl_chess:current_game';

/**
 * Update the current game ID
 * - In production (Vercel): writes to Redis
 * - In development: writes to file for local testing
 */
async function updateCurrentGameId(gameId) {
    if (IS_PRODUCTION) {
        try {
            if (!gameId) {
                await redis.del(REDIS_CURRENT_GAME_KEY);
                logger.info('Cleared current game in Redis');
            } else {
                await redis.set(REDIS_CURRENT_GAME_KEY, gameId);
                logger.info({ gameId }, 'Set current game in Redis');
            }
        } catch (err) {
            logger.error({ err, gameId }, 'Error setting/clearing current game in Redis');
        }
    } else {
        // Development: use file (works with local filesystem)
        try {
            if (!gameId) {
                if (fs.existsSync(GAME_ID_FILE_PATH)) fs.unlinkSync(GAME_ID_FILE_PATH);
                logger.info('Cleared current game file');
            } else {
                fs.writeFileSync(GAME_ID_FILE_PATH, gameId);
                logger.info({ gameId }, 'Set current game in file');
            }
        } catch (err) {
            logger.error({ err }, 'Error writing gameId to file');
        }
    }
}

/**
 * Get the current game ID
 * - In production (Vercel): reads from Redis
 * - In development: reads from file
 * Returns null if no current game is set
 */
async function getCurrentGameId() {
    if (IS_PRODUCTION) {
        // Production: read from Redis
        try {
            return await redis.get(REDIS_CURRENT_GAME_KEY);
        } catch (err) {
            logger.error({ err }, 'Error getting current game from Redis');
            return null;
        }
    } else {
        // Development: read from file
        try {
            if (fs.existsSync(GAME_ID_FILE_PATH)) {
                return fs.readFileSync(GAME_ID_FILE_PATH, 'utf8').trim();
            }
        } catch (err) {
            logger.error({ err }, 'Error reading gameId from file');
        }
        return null;
    }
}

// --- Input Validation Functions ---

/**
 * Validate player name
 * - Must be 1-20 characters
 * - Only letters, numbers, spaces, and basic punctuation
 */
function validatePlayerName(name) {
    if (!name || typeof name !== 'string') {
        return { valid: false, error: 'Player name is required' };
    }

    const trimmed = name.trim();

    if (trimmed.length < 1 || trimmed.length > 20) {
        return { valid: false, error: 'Player name must be 1-20 characters' };
    }

    // Allow letters, numbers, spaces, and basic punctuation
    if (!/^[a-zA-Z0-9\s\-_'.]+$/.test(trimmed)) {
        return { valid: false, error: 'Player name contains invalid characters' };
    }

    return { valid: true, name: trimmed };
}

/**
 * Validate chess move format
 * Accepts: "e2e4", "e2-e4", "e2 to e4", etc.
 * Returns normalized format: "e2e4"
 */
function validateMoveFormat(move) {
    if (!move || typeof move !== 'string') {
        return { valid: false, error: 'Move is required' };
    }

    // Normalize move (remove spaces, dashes, "to")
    const normalized = move.toLowerCase().replace(/[\s\-]/g, '').replace(/to/g, '');

    // Check basic format: letter+number+letter+number (e.g., "e2e4")
    // Also support promotion (e.g., "e7e8q")
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(normalized)) {
        return { valid: false, error: 'Invalid move format. Use format like "e2e4"' };
    }

    return { valid: true, move: normalized };
}

/**
 * Rate limiting middleware factory
 * Creates middleware that applies the specified rate limiter
 * Uses IP address as the identifier for rate limiting
 */
function createRateLimitMiddleware(limiterType) {
    return async (req, res, next) => {
        try {
            // Get client IP address (handles proxies and Vercel forwarding)
            const identifier = req.headers['x-forwarded-for']?.split(',')[0].trim() ||
                             req.headers['x-real-ip'] ||
                             req.socket.remoteAddress ||
                             'unknown';

            // Apply rate limit
            const { success, limit, remaining, reset } = await rateLimiters[limiterType].limit(identifier);

            // Add rate limit headers to response
            res.setHeader('X-RateLimit-Limit', limit.toString());
            res.setHeader('X-RateLimit-Remaining', remaining.toString());
            res.setHeader('X-RateLimit-Reset', new Date(reset).toISOString());

            if (!success) {
                const retryAfter = Math.ceil((reset - Date.now()) / 1000);
                res.setHeader('Retry-After', retryAfter.toString());
                return res.status(429).json({
                    message: 'Too many requests. Please try again later.',
                    retryAfter: retryAfter,
                    limit: limit,
                    reset: new Date(reset).toISOString()
                });
            }

            next();
        } catch (error) {
            // If rate limiting fails, log error but don't block the request
            logger.error({ err: error, limiterType }, 'Rate limiting error');
            next();
        }
    };
}

/**
 * Trigger TRMNL device refresh via webhook
 * Sends a POST request to the TRMNL webhook URL to force a display refresh
 * Rate limited to 12x per hour (or 30x for TRMNL+ subscribers)
 */
function triggerTRMNLRefresh() {
    const webhookUrl = process.env.TRMNL_WEBHOOK_URL;

    if (!webhookUrl) {
        logger.debug('TRMNL_WEBHOOK_URL not configured - skipping device refresh');
        return;
    }

    // Parse the webhook URL
    const url = new URL(webhookUrl);

    const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': 0
        }
    };

    const req = https.request(options, (res) => {
        if (res.statusCode === 200 || res.statusCode === 204) {
            logger.info('TRMNL device refresh triggered successfully');
        } else if (res.statusCode === 429) {
            logger.warn('TRMNL webhook rate limit exceeded (12/hour for standard, 30/hour for TRMNL+)');
        } else {
            logger.error({ statusCode: res.statusCode }, 'TRMNL webhook failed');
        }
    });

    req.setTimeout(4000, () => {
        logger.warn('TRMNL webhook request timed out');
        req.destroy();
    });

    req.on('error', (error) => {
        logger.error({ err: error }, 'Error triggering TRMNL refresh');
    });

    req.end();
}

// --- API Endpoints ---

// Endpoint for the trmnl plugin to poll
app.get('/api/trmnl-state', createRateLimitMiddleware('polling'), async (req, res) => {
    // Explicit no-cache to prevent stale board renders on devices/proxies
    res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
    });

    try {
        const gameId = await getCurrentGameId();

        if (!gameId) {
            // No current game set, return welcome state
            return res.json({ status: 'welcome' });
        }

        const gameState = await fetchGameState(gameId);
        if (!gameState) {
            return res.json({ status: 'welcome', error: 'Game not found in Redis' });
        }

        res.json(sanitizeGameState(gameState));
    } catch (err) {
        logger.error({ err }, 'Error in /api/trmnl-state');
        return res.json({ status: 'welcome', error: 'Internal server error' });
    }
});


// POST /api/games - Create a new game
app.post('/api/games', createRateLimitMiddleware('createGame'), async (req, res) => {
    const { player1, player2 } = req.body;

    // Validate player names
    const player1Validation = validatePlayerName(player1);
    if (!player1Validation.valid) {
        return res.status(400).json({ message: `Player 1: ${player1Validation.error}` });
    }

    const player2Validation = validatePlayerName(player2);
    if (!player2Validation.valid) {
        return res.status(400).json({ message: `Player 2: ${player2Validation.error}` });
    }

    const gameId = randomUUID().replace(/-/g, '').slice(0, 12);
    const writeToken = randomUUID().replace(/-/g, '');
    const chess = new Chess();

    const gameState = {
        id: gameId,
        players: [player1Validation.name, player2Validation.name],
        fen: chess.fen(),
        status: 'in_progress',
        winner: null,
        turn: 'w', // Explicitly set turn for the new game state
        lastMove: null, // No moves yet
        history: [], // Move history (SAN + meta)
        writeToken
    };
    try {
        await persistGameState(gameId, gameState, res);
    } catch {
        return; // Response already handled inside persistGameState
    }

    logger.info({ gameId }, 'Game created');

    await updateCurrentGameId(gameId);

    res.status(201).json(sanitizeGameState(gameState, { includeToken: true }));
});

// GET /api/games/:gameId - Get game state
app.get('/api/games/:gameId', async (req, res) => {
    const gameState = await fetchGameState(req.params.gameId);
    if (!gameState) {
        return res.status(404).json({ message: 'Game not found' });
    }

    // Ensure history exists for older records
    if (!Array.isArray(gameState.history)) {
        gameState.history = [];
    }
    
    res.json(sanitizeGameState(gameState));
});

// POST /api/games/:gameId/moves - Make a move
app.post('/api/games/:gameId/moves', createRateLimitMiddleware('makeMove'), async (req, res) => {
    const gameId = req.params.gameId;
    const gameState = await fetchGameState(gameId);
    if (!gameState) {
        return res.status(404).json({ message: 'Game not found' });
    }

    if (!authorizeGameWrite(req, gameState)) {
        return res.status(401).json({ message: 'Missing or invalid game token' });
    }

    if (gameState.status !== 'in_progress') {
        return res.status(400).json({ message: 'Game is over.' });
    }

    const { move } = req.body;

    // Validate move format before processing
        const moveValidation = validateMoveFormat(move);
    if (!moveValidation.valid) {
        return res.status(400).json({ message: moveValidation.error });
    }

    const chess = new Chess(gameState.fen);

    let result;
    try {
        result = chess.move(moveValidation.move, { sloppy: true });
    } catch (e) {
        return res.status(400).json({ message: 'Invalid move format.' });
    }

    if (result === null) {
        return res.status(400).json({ message: 'Illegal move.' });
    }

    // Update game state
    gameState.fen = chess.fen();
    gameState.turn = chess.turn();
    gameState.lastMove = { from: result.from, to: result.to }; // Track last move for highlighting

    // Ensure history array exists and record the move
    if (!Array.isArray(gameState.history)) {
        gameState.history = [];
    }
    gameState.history.push({
        san: result.san,
        from: result.from,
        to: result.to,
        color: result.color,
        piece: result.piece,
        captured: result.captured || null,
        fen: gameState.fen,
        at: Date.now()
    });

    // Check for game over conditions
    if (chess.isGameOver()) {
        if (chess.isCheckmate()) {
            gameState.status = 'checkmate';
            gameState.winner = chess.turn() === 'w' ? 'black' : 'white';
        } else if (chess.isStalemate()) {
            gameState.status = 'stalemate';
            gameState.winner = 'draw';
        } else {
            gameState.status = 'draw';
            gameState.winner = 'draw';
        }
    }

    try {
        await persistGameState(gameId, gameState, res);
    } catch {
        return;
    }
    logger.info({ gameId, move: moveValidation.move }, 'Move made');

    await updateCurrentGameId(gameId);

    // Trigger TRMNL device refresh after move
    triggerTRMNLRefresh();

    res.json(sanitizeGameState(gameState));
});

// POST /api/games/:gameId/resign - Resign the game
app.post('/api/games/:gameId/resign', createRateLimitMiddleware('gameAction'), async (req, res) => {
    const gameId = req.params.gameId;
    const gameState = await fetchGameState(gameId);
    if (!gameState) {
        return res.status(404).json({ message: 'Game not found' });
    }

    if (!authorizeGameWrite(req, gameState)) {
        return res.status(401).json({ message: 'Missing or invalid game token' });
    }

    if (gameState.status !== 'in_progress') {
        return res.status(400).json({ message: 'Game is already over' });
    }

    // Current player resigns, opponent wins
    const resigningPlayer = gameState.turn; // 'w' or 'b'
    const winner = resigningPlayer === 'w' ? 'black' : 'white';

    gameState.status = 'resignation';
    gameState.winner = winner;

    try {
        await persistGameState(gameId, gameState, res);
    } catch {
        return;
    }
    logger.info({ gameId, winner }, 'Player resigned');

    await updateCurrentGameId(gameId);

    // Trigger TRMNL device refresh after resignation
    triggerTRMNLRefresh();

    res.json(sanitizeGameState(gameState));
});

// POST /api/reset-current - clear the current game pointer and delete its state
app.post('/api/reset-current', createRateLimitMiddleware('gameAction'), async (req, res) => {
    try {
        const currentGameId = await getCurrentGameId();
        if (!currentGameId) {
            return res.json({ status: 'welcome' });
        }

        // Require the current game's write token to reset state
        const currentState = await fetchGameState(currentGameId);
        if (!authorizeGameWrite(req, currentState)) {
            return res.status(401).json({ message: 'Missing or invalid game token' });
        }

        await redis.del(currentGameId);
        await updateCurrentGameId(null);

        logger.info({ gameId: currentGameId }, 'Current game reset; returning to welcome');

        // Force device refresh so it polls and shows welcome
        triggerTRMNLRefresh();

        res.json({ status: 'welcome' });
    } catch (err) {
        logger.error({ err }, 'Failed to reset current game');
        res.status(500).json({ message: 'Failed to reset current game' });
    }
});

// POST /api/games/:gameId/undo - Undo the last move
app.post('/api/games/:gameId/undo', createRateLimitMiddleware('gameAction'), async (req, res) => {
    const gameId = req.params.gameId;
    const gameState = await fetchGameState(gameId);
    if (!gameState) {
        return res.status(404).json({ message: 'Game not found' });
    }

    if (!authorizeGameWrite(req, gameState)) {
        return res.status(401).json({ message: 'Missing or invalid game token' });
    }
    const chess = new Chess(gameState.fen);

    // Try to undo the last move
    const undoneMove = chess.undo();
    if (undoneMove === null) {
        return res.status(400).json({ message: 'No moves to undo' });
    }

    // Update game state
    gameState.fen = chess.fen();
    gameState.turn = chess.turn();

    // Remove the last recorded move from history (if present) to stay in sync
    if (Array.isArray(gameState.history) && gameState.history.length > 0) {
        gameState.history.pop();
    }

    // Update lastMove to the previous move (if any)
    const history = chess.history({ verbose: true });
    if (history.length > 0) {
        const prevMove = history[history.length - 1];
        gameState.lastMove = { from: prevMove.from, to: prevMove.to };
    } else {
        gameState.lastMove = null;
    }

    // If the game was over, set it back to in_progress
    if (gameState.status !== 'in_progress') {
        gameState.status = 'in_progress';
        gameState.winner = null;
    }

    try {
        await persistGameState(gameId, gameState, res);
    } catch {
        return;
    }
    logger.info({ gameId }, 'Move undone');

    await updateCurrentGameId(gameId);

    res.json(sanitizeGameState(gameState));
});

// POST /api/trigger-refresh - manually trigger TRMNL webhook
app.post('/api/trigger-refresh', createRateLimitMiddleware('gameAction'), async (_req, res) => {
    try {
        triggerTRMNLRefresh();
        res.json({ status: 'ok' });
    } catch (err) {
        logger.error({ err }, 'Failed to trigger TRMNL refresh');
        res.status(500).json({ message: 'Failed to trigger refresh' });
    }
});

// Serve QR code image (welcome screen) – generated dynamically to avoid missing asset in serverless deploys
app.get('/qr_code.png', async (req, res) => {
    try {
        const qrCodeBuffer = await QRCode.toBuffer(FRONTEND_URL, {
            errorCorrectionLevel: 'M',
            type: 'png',
            width: 220
        });
        res.setHeader('Content-Type', 'image/png');
        res.send(qrCodeBuffer);
    } catch (err) {
        logger.error({ err }, 'Error generating welcome QR code');
        res.status(500).send('Error generating QR code');
    }
});

// Generate game-specific QR code
app.get('/api/games/:gameId/qr', async (req, res) => {
    const gameId = req.params.gameId;
    const gameState = await fetchGameState(gameId);
    if (!gameState) {
        return res.status(404).send('Game not found');
    }

    const gameURL = `${FRONTEND_URL}/game.html?gameId=${gameId}&token=${gameState.writeToken}`;

    try {
        const qrCodeBuffer = await QRCode.toBuffer(gameURL, {
            errorCorrectionLevel: 'M',
            type: 'png',
            width: 200
        });
        res.setHeader('Content-Type', 'image/png');
        res.send(qrCodeBuffer);
    } catch (err) {
        logger.error({ err }, 'Error generating QR code');
        res.status(500).send('Error generating QR code');
    }
});

// Serve frontend
app.get('/', (_req, res) => {
    res.sendFile(path.join(SITE_DIR, 'index.html'));
});

// Fallback for non-API routes to static files (basic multi-page support)
app.get(/^\/(?!api\/).+/, (req, res, next) => {
    const requested = path.join(SITE_DIR, req.path);
    if (fs.existsSync(requested) && fs.statSync(requested).isFile()) {
        return res.sendFile(requested);
    }
    return res.sendFile(path.join(SITE_DIR, 'index.html'));
});

if (process.env.SENTRY_DSN) {
    app.use(Sentry.Handlers.errorHandler());
}

app.listen(port, () => {
  logger.info(`Backend server listening at http://localhost:${port}`);
});

// --- Helpers ---

/**
 * Persist game state with error handling
 */
async function persistGameState(gameId, gameState, res) {
    try {
        await redis.set(gameId, JSON.stringify(gameState));
    } catch (err) {
        logger.error({ err, gameId }, 'Failed to persist game state');
        if (res && !res.headersSent) {
            res.status(500).json({ message: 'Failed to persist game state' });
        }
        throw err;
    }
}

/**
 * Fetch game state from Redis
 */
async function fetchGameState(gameId) {
    try {
        const raw = await redis.get(gameId);
        if (!raw) return null;

        // Upstash REST client returns an object; ioredis returns a string.
        let jsonString = raw;
        if (typeof raw === 'object') {
            // Upstash client shape is usually { result: '...' } or { data: '...' }
            jsonString = raw.result ?? raw.data ?? raw.value ?? JSON.stringify(raw);
        }

        // Guard against non-string payloads before parsing
        if (typeof jsonString !== 'string') {
            jsonString = String(jsonString);
        }

        return JSON.parse(jsonString);
    } catch (err) {
        logger.error({ err, gameId }, 'Failed to fetch game state');
        return null;
    }
}

/**
 * Strip sensitive fields unless explicitly requested
 */
function sanitizeGameState(gameState, options = {}) {
    const clone = { ...gameState };
    if (!options.includeToken) {
        delete clone.writeToken;
    }
    return clone;
}

/**
 * Authorize modifying a game state with token
 */
function authorizeGameWrite(req, gameState) {
    if (!gameState || !gameState.writeToken) return false;

    // Prefer explicit header; allow fallback to query/body token for compatibility
    const headerToken = req.headers['x-game-token'] || req.headers['x-gametoken'];
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
    const tokenFromParams = req.query?.token || req.body?.token;

    const token = headerToken || bearer || tokenFromParams;

    return token === gameState.writeToken;
}
