import "dotenv/config";

import http from "http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
// import { initSocket } from "./socket.js";
import { connectDB } from "./config/db.js";

process.env.TZ = "Africa/Addis_Ababa";

const NODE_ENV = process.env.NODE_ENV ?? "development";
const PORT = process.env.PORT ?? 8000;
const BODY_LIMIT = "1000mb";
const PARAM_LIMIT = 1_000_000;

// ─── Origin allow-list ─────────────────────────────────────────────────────

function normalizeOrigin(value) {
  if (!value) return "";
  const raw = String(value).trim();
  try {
    const { protocol, host } = new URL(raw);
    return `${protocol}//${host}`.toLowerCase();
  } catch {
    return raw.replace(/\/+$/, "").toLowerCase();
  }
}

const staticAllowedOrigins = [process.env.FRONT_END_HOST].filter((v) =>
  Boolean(v),
);

const staticAllowedOriginSet = new Set(
  staticAllowedOrigins.map(normalizeOrigin),
);

/**
 * Shared origin predicate used by both the Express CORS middleware and the
 * Socket.IO server so the allow-list is defined exactly once.
 */
export function isOriginAllowed(origin) {
  if (!origin) return true;
  const normalised = normalizeOrigin(origin);
  return Boolean(normalised) && staticAllowedOriginSet.has(normalised);
}

// ─── Express app ──────────────────────────────────────────────────────────

const app = express();

app.set("trust proxy", 1);

// ── CORS ───────────────────────────────────────────────────────────────────

const corsOptions = {
  origin(origin, callback) {
    isOriginAllowed(origin)
      ? callback(null, true)
      : callback(new Error("Not allowed by CORS"));
  },
};

app.use(cors(corsOptions));

// ── HTTPS redirect (production only) ──────────────────────────────────────

app.use((req, res, next) => {
  if (NODE_ENV === "production" && !req.secure) {
    res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    return;
  }
  next();
});

// ── Helmet / CSP ───────────────────────────────────────────────────────────

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", ...staticAllowedOrigins],
        "font-src": ["'self'", "https:", "data:"],
        "connect-src": ["'self'", ...staticAllowedOrigins, "wss:", "https:"],
        "frame-src": staticAllowedOrigins.length
          ? staticAllowedOrigins
          : ["'self'"],
        "frame-ancestors": ["'self'", ...staticAllowedOrigins],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
      },
    },
    hsts: {
      maxAge: 60 * 60 * 24 * 365,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: false,
    noSniff: true,
    referrerPolicy: { policy: "no-referrer" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
  }),
);

app.use((_req, res, next) => {
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

// ── Body parsing ───────────────────────────────────────────────────────────

function saveRawBody(req, _res, buf, encoding) {
  req.rawBody = buf?.length ? buf.toString(encoding ?? "utf8") : "";
}

app.use(express.static("Media"));
app.use("/Media/", express.static("Media"));

app.use(
  express.json({
    limit: BODY_LIMIT,
    strict: true,
    inflate: true,
    type: ["application/json", "application/*+json"],
    verify: saveRawBody,
  }),
);

app.use(
  express.urlencoded({
    limit: BODY_LIMIT,
    extended: true,
    parameterLimit: PARAM_LIMIT,
    inflate: true,
    verify: saveRawBody,
  }),
);

// ─── REST routes ───────────────────────────────────────────────────────────

// Mount route modules here, e.g.:
// app.use(`${API}/books_api`, bookRoutes);
app.use("abugida_api/users", require("./routes/user/userRoutes.js"));

// ─── 404 catch-all ─────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json("The requested resource is not found.");
});

// ─── HTTP server + Socket.IO ───────────────────────────────────────────────

const httpServer = http.createServer(app);

// Socket.IO is fully owned by the socket module.
// `isOriginAllowed` is passed in so both layers share the same allow-list
// without the socket module depending on server.ts (avoiding circular imports).
// initSocket(httpServer, isOriginAllowed);

httpServer.listen(PORT, () => {
  connectDB();
  console.log(`[server] Listening on port ${PORT} (${NODE_ENV})`);
});
