"use strict";

require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const multer = require("multer");
const admin = require("firebase-admin");
const cloudinary = require("cloudinary").v2;

/* =========================================================
   1. CONFIG
   ========================================================= */

const CONFIG = {
  env: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 3000,
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || "",
  adminRole: process.env.ADMIN_ROLE || "superadmin",
  jwtSecret: process.env.JWT_SECRET || "",
  jwtExpires: process.env.JWT_EXPIRES_IN || "7d",
  jwtRememberExpires: process.env.JWT_REMEMBER_EXPIRES_IN || "30d",
  cookieName: process.env.COOKIE_NAME || "alafeen_token",
  cookieSecure: String(process.env.COOKIE_SECURE || "true") === "true",
  cookieSameSite: process.env.COOKIE_SAME_SITE || "strict",
  corsOrigins: (process.env.CORS_ORIGINS || "")
    .split(",").map((s) => s.trim()).filter(Boolean),
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || "",
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
    apiKey: process.env.CLOUDINARY_API_KEY || "",
    apiSecret: process.env.CLOUDINARY_API_SECRET || "",
    folder: process.env.CLOUDINARY_FOLDER || "alafeen",
  },
  rate: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX) || 300,
    loginWindowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    loginMax: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10,
  },
};

const REQUIRED_ENV = [
  ["JWT_SECRET", CONFIG.jwtSecret],
  ["ADMIN_USERNAME", CONFIG.adminUsername],
  ["ADMIN_PASSWORD_HASH", CONFIG.adminPasswordHash],
  ["FIREBASE_PROJECT_ID", CONFIG.firebase.projectId],
  ["FIREBASE_CLIENT_EMAIL", CONFIG.firebase.clientEmail],
  ["FIREBASE_PRIVATE_KEY", CONFIG.firebase.privateKey],
];

const validateEnv = () => {
  const missing = REQUIRED_ENV.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    throw new Error(`Missing env: ${missing.join(", ")}`);
  }
  if (CONFIG.jwtSecret.length < 32) {
    console.error("JWT_SECRET must be at least 32 characters.");
    throw new Error("JWT_SECRET too short");
  }
};

/* =========================================================
   2. FIREBASE
   ========================================================= */

let db = null;

const initFirebase = () => {
  if (admin.apps.length) {
    db = admin.firestore();
    return;
  }
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: CONFIG.firebase.projectId,
      clientEmail: CONFIG.firebase.clientEmail,
      privateKey: CONFIG.firebase.privateKey,
    }),
  });
  db = admin.firestore();
  db.settings({ ignoreUndefinedProperties: true });
};

const col = (name) => {
  if (!db) throw new Error("Firestore not initialized");
  return db.collection(name);
};

const nowTs = () => admin.firestore.Timestamp.now();
const Timestamp = () => admin.firestore.Timestamp;

const toIso = (v) => {
  if (!v) return null;
  if (v.toDate) return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  return v;
};

const normalizeDoc = (doc) => {
  if (!doc || !doc.exists) return null;
  const data = doc.data() || {};
  const out = { id: doc.id };
  for (const [k, v] of Object.entries(data)) {
    out[k] = v && v.toDate ? v.toDate().toISOString() : v;
  }
  return out;
};

/* =========================================================
   3. CLOUDINARY
   ========================================================= */

const initCloudinary = () => {
  if (!CONFIG.cloudinary.cloudName) return;
  cloudinary.config({
    cloud_name: CONFIG.cloudinary.cloudName,
    api_key: CONFIG.cloudinary.apiKey,
    api_secret: CONFIG.cloudinary.apiSecret,
    secure: true,
  });
};

const uploadBuffer = (buffer, folder) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: folder || CONFIG.cloudinary.folder, resource_type: "image" },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });

/* =========================================================
   4. APP + MIDDLEWARE
   ========================================================= */

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

const isProd = CONFIG.env === "production";

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.jsdelivr.net"],
      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
      "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
      "img-src": [
        "'self'", "data:", "blob:",
        "https://res.cloudinary.com",
        "https://*.tile.openstreetmap.org",
        "https://unpkg.com",
      ],
      "connect-src": ["'self'", "https://*.tile.openstreetmap.org"],
      "frame-ancestors": ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));

app.use(compression());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(cookieParser());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (!CONFIG.corsOrigins.length) return cb(null, true);
    if (CONFIG.corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));

if (!isProd) app.use(morgan("dev"));

/* =========================================================
   5. ERROR + RESPONSE HELPERS
   ========================================================= */

class ApiError extends Error {
  constructor(status, message, code) {
    super(message || "حدث خطأ");
    this.status = status || 500;
    this.code = code || null;
  }
}

const ok = (res, data = {}, status = 200) =>
  res.status(status).json({ ok: true, ...data });

const fail = (res, status, message, extra = {}) =>
  res.status(status).json({ ok: false, message, ...extra });

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/* =========================================================
   6. AUTH (JWT)
   ========================================================= */

const signToken = (adminUser, remember) => {
  const expiresIn = remember ? CONFIG.jwtRememberExpires : CONFIG.jwtExpires;
  return jwt.sign(
    { sub: adminUser.username, role: adminUser.role },
    CONFIG.jwtSecret,
    { expiresIn, issuer: "alafeen" }
  );
};

const parseDurationMs = (value) => {
  const m = String(value).match(/^(\d+)([smhd])$/);
  if (!m) return 7 * 24 * 3600 * 1000;
  const n = Number(m[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
  return n * unit;
};

const setAuthCookie = (res, token, remember) => {
  const maxAge = parseDurationMs(remember ? CONFIG.jwtRememberExpires : CONFIG.jwtExpires);
  res.cookie(CONFIG.cookieName, token, {
    httpOnly: true,
    secure: CONFIG.cookieSecure,
    sameSite: CONFIG.cookieSameSite,
    maxAge,
    path: "/",
  });
};

const clearAuthCookie = (res) => {
  res.clearCookie(CONFIG.cookieName, {
    httpOnly: true,
    secure: CONFIG.cookieSecure,
    sameSite: CONFIG.cookieSameSite,
    path: "/",
  });
};

const requireAuth = (req, res, next) => {
  const token = req.cookies[CONFIG.cookieName];
  if (!token) return fail(res, 401, "غير مصرح");
  try {
    const decoded = jwt.verify(token, CONFIG.jwtSecret, { issuer: "alafeen" });
    req.admin = { username: decoded.sub, role: decoded.role };
    return next();
  } catch (_) {
    clearAuthCookie(res);
    return fail(res, 401, "انتهت الجلسة");
  }
};

/* =========================================================
   6.5. CSRF (Double Submit Cookie)
   ========================================================= */

const CSRF_COOKIE = "alafeen_csrf";
const CSRF_HEADER = "x-csrf-token";
const CSRF_SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

const generateCsrfToken = () => crypto.randomBytes(32).toString("hex");

const setCsrfCookie = (res, token) => {
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: CONFIG.cookieSecure,
    sameSite: CONFIG.cookieSameSite,
    maxAge: parseDurationMs(CONFIG.jwtRememberExpires),
    path: "/",
  });
};

const clearCsrfCookie = (res) => {
  res.clearCookie(CSRF_COOKIE, {
    httpOnly: false,
    secure: CONFIG.cookieSecure,
    sameSite: CONFIG.cookieSameSite,
    path: "/",
  });
};

const requireCsrf = (req, res, next) => {
  if (CSRF_SAFE_METHODS.includes(req.method)) return next();
  const cookieToken = req.cookies[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return fail(res, 403, "رمز الحماية غير صحيح، أعد تحميل الصفحة");
  }
  return next();
};

/* =========================================================
   7. RATE LIMITERS
   ========================================================= */

const globalLimiter = rateLimit({
  windowMs: CONFIG.rate.windowMs,
  max: CONFIG.rate.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: "تم تجاوز الحد، حاول بعد قليل" },
});

const loginLimiter = rateLimit({
  windowMs: CONFIG.rate.loginWindowMs,
  max: CONFIG.rate.loginMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: "تم تجاوز عدد محاولات الدخول، حاول بعد قليل" },
});

app.use("/api", globalLimiter);
app.use("/api/auth/login", loginLimiter);

/* =========================================================
   8. VALIDATION + SANITIZATION
   ========================================================= */

const isPlainObject = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const sanitizeString = (v, max = 2000) => {
  if (v === null || v === undefined) return "";
  const s = String(v).trim().slice(0, max);
  return s.replace(/[<>]/g, "");
};

const requireFields = (body, fields) => {
  const missing = fields.filter((f) => {
    const v = body[f];
    return v === undefined || v === null || (typeof v === "string" && !v.trim());
  });
  if (missing.length) throw new ApiError(400, `الحقول المطلوبة: ${missing.join(", ")}`);
};

const pickFields = (body, allowed) => {
  const out = {};
  if (!isPlainObject(body)) return out;
  for (const key of allowed) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
};

const parsePagination = (query) => {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const offset = Math.max(Number(query.offset) || 0, 0);
  return { limit, offset };
};

const parseSort = (query) => {
  const raw = String(query.sort || "createdAt:desc");
  const [field, dir] = raw.split(":");
  const safeField = /^[a-zA-Z0-9_]+$/.test(field) ? field : "createdAt";
  const safeDir = dir === "asc" ? "asc" : "desc";
  return { field: safeField, dir: safeDir };
};

/* =========================================================
   9. ADMIN LOGS
   ========================================================= */

const logAdmin = async (req, action, resource, resourceId, metadata = {}) => {
  try {
    await col("adminLogs").add({
      adminId: req.admin ? req.admin.username : "unknown",
      action,
      resource,
      resourceId: resourceId || null,
      ip: req.ip || null,
      userAgent: req.headers["user-agent"] || null,
      metadata,
      timestamp: nowTs(),
    });
  } catch (_) {}
};

/* =========================================================
   10. FIRESTORE HELPERS
   ========================================================= */

const applyFilters = (query, filters) => {
  for (const [field, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    query = query.where(field, "==", value);
  }
  return query;
};

const listCollection = async (name, options = {}) => {
  const {
    filters = {},
    limit = 50,
    offset = 0,
    sort = { field: "createdAt", dir: "desc" },
    search = null,
    searchFields = [],
  } = options;

  let query = col(name);
  query = applyFilters(query, filters);

  if (sort.field) query = query.orderBy(sort.field, sort.dir);

  query = query.limit(offset + limit);

  const snap = await query.get();
  let items = snap.docs.map(normalizeDoc);

  if (search && searchFields.length) {
    const q = search.toLowerCase();
    items = items.filter((it) =>
      searchFields.some((f) => String(it[f] || "").toLowerCase().includes(q))
    );
  }

  const total = items.length;
  items = items.slice(offset, offset + limit);
  return { items, total };
};

const getDoc = async (name, id) => {
  const doc = await col(name).doc(id).get();
  return normalizeDoc(doc);
};

const createDoc = async (name, data) => {
  const payload = {
    ...data,
    deleted: false,
    createdAt: nowTs(),
    updatedAt: nowTs(),
  };
  const ref = await col(name).add(payload);
  const doc = await ref.get();
  return normalizeDoc(doc);
};

const updateDoc = async (name, id, data) => {
  const ref = col(name).doc(id);
  const existing = await ref.get();
  if (!existing.exists) throw new ApiError(404, "العنصر غير موجود");
  await ref.update({ ...data, updatedAt: nowTs() });
  const updated = await ref.get();
  return normalizeDoc(updated);
};

const deleteDoc = async (name, id) => {
  const ref = col(name).doc(id);
  const existing = await ref.get();
  if (!existing.exists) throw new ApiError(404, "العنصر غير موجود");
  await ref.delete();
  return true;
};

/* =========================================================
   11. AUTH ROUTES
   ========================================================= */

app.post("/api/auth/login", asyncHandler(async (req, res) => {
  const { username, password, remember } = req.body || {};

  if (!username || !password) {
    return fail(res, 400, "اسم المستخدم وكلمة المرور مطلوبان");
  }

  const uname = sanitizeString(username, 64);
  if (uname !== CONFIG.adminUsername) {
    return fail(res, 401, "اسم المستخدم أو كلمة المرور غير صحيحة");
  }

  const valid = await bcrypt.compare(String(password), CONFIG.adminPasswordHash);
  if (!valid) {
    return fail(res, 401, "اسم المستخدم أو كلمة المرور غير صحيحة");
  }

  const adminUser = { username: CONFIG.adminUsername, role: CONFIG.adminRole };
  const token = signToken(adminUser, !!remember);
  setAuthCookie(res, token, !!remember);

  const csrf = generateCsrfToken();
  setCsrfCookie(res, csrf);

  await col("adminLogs").add({
    adminId: adminUser.username,
    action: "login",
    resource: "auth",
    resourceId: null,
    ip: req.ip,
    userAgent: req.headers["user-agent"] || null,
    metadata: { remember: !!remember },
    timestamp: nowTs(),
  }).catch(() => {});

  return ok(res, { admin: adminUser, redirect: "/dashboard.html", csrf });
}));

app.post("/api/auth/logout", requireAuth, requireCsrf, asyncHandler(async (req, res) => {
  clearAuthCookie(res);
  clearCsrfCookie(res);
  await logAdmin(req, "logout", "auth", null);
  return ok(res);
}));

app.get("/api/auth/me", requireAuth, asyncHandler(async (req, res) => {
  return ok(res, { admin: req.admin });
}));

/* =========================================================
   12. DASHBOARD STATS
   ========================================================= */

const buildTrend7d = async () => {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  const start = days[0];

  try {
    const snap = await col("complaints")
      .where("createdAt", ">=", Timestamp().fromDate(start))
      .get();

    const buckets = days.map((d) => ({
      label: new Intl.DateTimeFormat("ar-EG", { weekday: "short" }).format(d),
      count: 0,
    }));

    snap.forEach((doc) => {
      const data = doc.data();
      const dt = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate() : null;
      if (!dt) return;
      const dd = new Date(dt);
      dd.setHours(0, 0, 0, 0);
      const diff = Math.floor((dd.getTime() - start.getTime()) / 86400000);
      if (diff >= 0 && diff < 7) buckets[diff].count++;
    });

    return buckets;
  } catch (_) {
    return days.map((d) => ({
      label: new Intl.DateTimeFormat("ar-EG", { weekday: "short" }).format(d),
      count: 0,
    }));
  }
};

app.get("/api/dashboard/stats", requireAuth, asyncHandler(async (req, res) => {
  const [
    usersCount,
    activeUsersCount,
    routesCount,
    stationsCount,
    transportCount,
    complaintsCount,
    newComplaints,
    reviewingComplaints,
    verifiedComplaints,
    rejectedComplaints,
    resolvedComplaints,
  ] = await Promise.all([
    col("users").count().get(),
    col("users").where("active", "==", true).count().get(),
    col("routes").count().get(),
    col("stations").count().get(),
    col("transportTypes").count().get(),
    col("complaints").count().get(),
    col("complaints").where("status", "==", "new").count().get(),
    col("complaints").where("status", "==", "reviewing").count().get(),
    col("complaints").where("status", "==", "verified").count().get(),
    col("complaints").where("status", "==", "rejected").count().get(),
    col("complaints").where("status", "==", "resolved").count().get(),
  ]);

  const mapSnap = await col("complaints")
    .where("status", "in", ["new", "reviewing", "verified"])
    .orderBy("createdAt", "desc")
    .limit(100)
    .get()
    .catch(() => null);

  const mapPoints = mapSnap
    ? mapSnap.docs
        .map(normalizeDoc)
        .filter((c) => !c.deleted && typeof c.latitude === "number" && typeof c.longitude === "number")
        .map((c) => ({ lat: c.latitude, lng: c.longitude, title: c.title || "بلاغ", id: c.id }))
    : [];

  const trend7d = await buildTrend7d();

  const syncDoc = await col("syncMetadata").doc("global").get().catch(() => null);

  return ok(res, {
    totalUsers: usersCount.data().count,
    activeUsers: activeUsersCount.data().count,
    totalRoutes: routesCount.data().count,
    totalStations: stationsCount.data().count,
    totalTransportTypes: transportCount.data().count,
    totalComplaints: complaintsCount.data().count,
    newComplaints: newComplaints.data().count,
    reviewingComplaints: reviewingComplaints.data().count,
    verifiedComplaints: verifiedComplaints.data().count,
    rejectedComplaints: rejectedComplaints.data().count,
    resolvedComplaints: resolvedComplaints.data().count,
    lastUpdated: syncDoc && syncDoc.exists ? toIso(syncDoc.data().lastSync) : null,
    mapPoints,
    trend7d,
  });
}));

/* =========================================================
   13. GENERIC CRUD FACTORY
   ========================================================= */

const registerCrud = ({
  path: basePath,
  collection: colName,
  allowedFields,
  requiredOnCreate,
  searchFields = [],
  defaultSort = { field: "createdAt", dir: "desc" },
  logResource,
  listFilters = [],
}) => {
  app.get(`/api/${basePath}`, requireAuth, asyncHandler(async (req, res) => {
    const { limit, offset } = parsePagination(req.query);
    const sort = parseSort(req.query);
    const filters = {};
    for (const f of listFilters) {
      if (req.query[f] !== undefined) filters[f] = req.query[f];
    }
    const { items, total } = await listCollection(colName, {
      filters, limit, offset,
      sort: sort.field ? sort : defaultSort,
      search: req.query.q,
      searchFields,
    });
    return ok(res, { items, total, limit, offset });
  }));

  app.get(`/api/${basePath}/:id`, requireAuth, asyncHandler(async (req, res) => {
    const doc = await getDoc(colName, req.params.id);
    if (!doc) return fail(res, 404, "العنصر غير موجود");
    return ok(res, { item: doc });
  }));

  app.post(`/api/${basePath}`, requireAuth, requireCsrf, asyncHandler(async (req, res) => {
    if (requiredOnCreate) requireFields(req.body, requiredOnCreate);
    const data = pickFields(req.body, allowedFields);
    const created = await createDoc(colName, data);
    await logAdmin(req, "create", logResource || colName, created.id, data);
    return ok(res, { item: created }, 201);
  }));

  app.put(`/api/${basePath}/:id`, requireAuth, requireCsrf, asyncHandler(async (req, res) => {
    const data = pickFields(req.body, allowedFields);
    const updated = await updateDoc(colName, req.params.id, data);
    await logAdmin(req, "update", logResource || colName, req.params.id, data);
    return ok(res, { item: updated });
  }));

  app.delete(`/api/${basePath}/:id`, requireAuth, requireCsrf, asyncHandler(async (req, res) => {
    await deleteDoc(colName, req.params.id);
    await logAdmin(req, "delete", logResource || colName, req.params.id);
    return ok(res);
  }));
};

/* =========================================================
   14. REGISTER CRUD
   ========================================================= */

registerCrud({
  path: "routes",
  collection: "routes",
  logResource: "route",
  searchFields: ["name", "startPoint", "endPoint"],
  listFilters: ["active", "transportType"],
  requiredOnCreate: ["name"],
  allowedFields: [
    "name", "transportType", "startPoint", "endPoint", "stops",
    "estimatedDuration", "price", "active", "notes",
  ],
});

registerCrud({
  path: "stations",
  collection: "stations",
  logResource: "station",
  searchFields: ["name", "area"],
  listFilters: ["active", "governorate", "area"],
  requiredOnCreate: ["name"],
  allowedFields: [
    "name", "area", "governorate", "latitude", "longitude",
    "transportTypes", "routes", "active",
  ],
});

registerCrud({
  path: "transport-types",
  collection: "transportTypes",
  logResource: "transportType",
  searchFields: ["name", "slug"],
  listFilters: ["active"],
  requiredOnCreate: ["name"],
  allowedFields: ["name", "slug", "active", "description"],
});

registerCrud({
  path: "fares",
  collection: "fares",
  logResource: "fare",
  searchFields: ["transport", "route"],
  listFilters: ["transport", "route"],
  requiredOnCreate: ["transport", "price"],
  allowedFields: [
    "transport", "route", "price", "currency",
    "effectiveFrom", "lastUpdated",
  ],
});

registerCrud({
  path: "governorates",
  collection: "governorates",
  logResource: "governorate",
  searchFields: ["name", "nameEn"],
  listFilters: ["active"],
  requiredOnCreate: ["name"],
  allowedFields: ["name", "nameEn", "code", "active"],
});

registerCrud({
  path: "cities",
  collection: "cities",
  logResource: "city",
  searchFields: ["name"],
  listFilters: ["governorateId", "active"],
  requiredOnCreate: ["name", "governorateId"],
  allowedFields: ["name", "governorateId", "active"],
});

registerCrud({
  path: "areas",
  collection: "areas",
  logResource: "area",
  searchFields: ["name"],
  listFilters: ["cityId", "governorateId", "active"],
  requiredOnCreate: ["name", "cityId"],
  allowedFields: ["name", "cityId", "governorateId", "active"],
});

/* =========================================================
   15. COMPLAINTS
   ========================================================= */

const COMPLAINT_STATUSES = ["new", "reviewing", "verified", "rejected", "resolved"];
const COMPLAINT_PRIORITIES = ["low", "medium", "high", "critical"];

app.get("/api/complaints", requireAuth, asyncHandler(async (req, res) => {
  const { limit, offset } = parsePagination(req.query);
  const sort = parseSort(req.query);
  const filters = {};

  if (req.query.status) filters.status = req.query.status;
  if (req.query.priority) filters.priority = req.query.priority;
  if (req.query.type) filters.type = req.query.type;
  if (req.query.includeDeleted !== "true") filters.deleted = false;

  const { items, total } = await listCollection("complaints", {
    filters, limit, offset, sort,
    search: req.query.q,
    searchFields: ["title", "description", "location"],
  });

  return ok(res, { items, total, limit, offset });
}));

app.get("/api/complaints/:id", requireAuth, asyncHandler(async (req, res) => {
  const item = await getDoc("complaints", req.params.id);
  if (!item) return fail(res, 404, "البلاغ غير موجود");
  return ok(res, { item });
}));

app.put("/api/complaints/:id", requireAuth, requireCsrf, asyncHandler(async (req, res) => {
  const data = pickFields(req.body, [
    "status", "priority", "adminNote", "verified",
    "title", "description", "location", "transportType", "routeId",
  ]);

  if (data.status && !COMPLAINT_STATUSES.includes(data.status)) {
    return fail(res, 400, "حالة غير صحيحة");
  }
  if (data.priority && !COMPLAINT_PRIORITIES.includes(data.priority)) {
    return fail(res, 400, "أولوية غير صحيحة");
  }

  const updated = await updateDoc("complaints", req.params.id, data);
  await logAdmin(req, "update", "complaint", req.params.id, data);
  return ok(res, { item: updated });
}));

app.delete("/api/complaints/:id", requireAuth, requireCsrf, asyncHandler(async (req, res) => {
  const { reason } = req.body || {};
  if (!reason || !String(reason).trim()) {
    return fail(res, 400, "سبب الحذف مطلوب");
  }

  const ref = col("complaints").doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) return fail(res, 404, "البلاغ غير موجود");

  await ref.update({
    deleted: true,
    deletedAt: nowTs(),
    deletedBy: req.admin.username,
    deleteReason: sanitizeString(reason, 500),
    status: "rejected",
    updatedAt: nowTs(),
  });

  await logAdmin(req, "spam_delete", "complaint", req.params.id, {
    reason: sanitizeString(reason, 500),
  });

  return ok(res);
}));

app.post("/api/complaints/:id/confirm", requireAuth, requireCsrf, asyncHandler(async (req, res) => {
  const ref = col("complaints").doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) return fail(res, 404, "البلاغ غير موجود");

  const current = snap.data() || {};
  const confirmations = (current.confirmations || 0) + 1;
  let priority = current.priority || "low";

  if (confirmations >= 50) priority = "critical";
  else if (confirmations >= 25) priority = "high";
  else if (confirmations >= 10) priority = "medium";

  await ref.update({ confirmations, priority, updatedAt: nowTs() });
  await logAdmin(req, "confirm", "complaint", req.params.id, { confirmations, priority });
  return ok(res, { confirmations, priority });
}));

/* =========================================================
   16. SUGGESTIONS
   ========================================================= */

app.get("/api/suggestions", requireAuth, asyncHandler(async (req, res) => {
  const { limit, offset } = parsePagination(req.query);
  const sort = parseSort(req.query);
  const filters = {};
  if (req.query.status) filters.status = req.query.status;
  if (req.query.includeDeleted !== "true") filters.deleted = false;

  const { items, total } = await listCollection("suggestions", {
    filters, limit, offset, sort,
    search: req.query.q,
    searchFields: ["title", "description"],
  });
  return ok(res, { items, total, limit, offset });
}));

app.post("/api/suggestions", requireAuth, requireCsrf, asyncHandler(async (req, res) => {
  requireFields(req.body, ["title"]);
  const data = pickFields(req.body, [
    "title", "description", "location", "latitude", "longitude",
    "transportType", "routeId", "userId", "images", "status", "priority", "adminNote",
  ]);
  const created = await createDoc("suggestions", data);
  await logAdmin(req, "create", "suggestion", created.id);
  return ok(res, { item: created }, 201);
}));

app.put("/api/suggestions/:id", requireAuth, requireCsrf, asyncHandler(async (req, res) => {
  const data = pickFields(req.body, [
    "status", "priority", "adminNote", "title", "description",
  ]);
  const updated = await updateDoc("suggestions", req.params.id, data);
  await logAdmin(req, "update", "suggestion", req.params.id, data);
  return ok(res, { item: updated });
}));

/* =========================================================
   17. USERS
   ========================================================= */

app.get("/api/users", requireAuth, asyncHandler(async (req, res) => {
  const { limit, offset } = parsePagination(req.query);
  const sort = parseSort(req.query);
  const filters = {};
  if (req.query.active !== undefined) filters.active = req.query.active === "true";

  const { items, total } = await listCollection("users", {
    filters, limit, offset, sort,
    search: req.query.q,
    searchFields: ["name", "email", "phone"],
  });
  return ok(res, { items, total, limit, offset });
}));

app.get("/api/users/:id", requireAuth, asyncHandler(async (req, res) => {
  const item = await getDoc("users", req.params.id);
  if (!item) return fail(res, 404, "المستخدم غير موجود");
  return ok(res, { item });
}));

/* =========================================================
   18. REPORTS
   ========================================================= */

app.get("/api/reports", requireAuth, asyncHandler(async (req, res) => {
  const { limit, offset } = parsePagination(req.query);
  const sort = parseSort(req.query);
  const { items, total } = await listCollection("reports", {
    filters: {}, limit, offset, sort,
    search: req.query.q,
    searchFields: ["title", "type"],
  });
  return ok(res, { items, total, limit, offset });
}));

/* =========================================================
   19. ADMIN LOGS
   ========================================================= */

app.get("/api/admin-logs", requireAuth, asyncHandler(async (req, res) => {
  const { limit, offset } = parsePagination(req.query);
  const { items, total } = await listCollection("adminLogs", {
    filters: {}, limit, offset,
    sort: { field: "timestamp", dir: "desc" },
  });
  return ok(res, { items, total, limit, offset });
}));

/* =========================================================
   20. UPLOAD (Cloudinary)
   ========================================================= */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) {
      return cb(new ApiError(400, "صيغة الصورة غير مدعومة"));
    }
    cb(null, true);
  },
});

app.post(
  "/api/upload",
  requireAuth,
  requireCsrf,
  upload.array("files", 6),
  asyncHandler(async (req, res) => {
    if (!CONFIG.cloudinary.cloudName) {
      return fail(res, 500, "خدمة الصور غير مهيأة");
    }
    if (!req.files || !req.files.length) {
      return fail(res, 400, "لم يتم إرسال أي ملفات");
    }
    const folder = sanitizeString(req.body.folder || "", 64) || CONFIG.cloudinary.folder;
    const results = await Promise.all(
      req.files.map((f) => uploadBuffer(f.buffer, folder))
    );
    const items = results.map((r) => ({
      secure_url: r.secure_url,
      public_id: r.public_id,
      width: r.width,
      height: r.height,
      format: r.format,
      createdAt: r.created_at,
    }));
    await logAdmin(req, "upload", "cloudinary", null, { count: items.length, folder });
    return ok(res, { items });
  })
);

/* =========================================================
   21. GLOBAL SEARCH
   ========================================================= */

app.get("/api/search", requireAuth, asyncHandler(async (req, res) => {
  const q = sanitizeString(req.query.q || "", 80).toLowerCase();
  if (q.length < 2) {
    return ok(res, {
      routes: [], stations: [], complaints: [], users: [],
      governorates: [], transport: [],
    });
  }

  const searchIn = async (name, fields, limit = 5) => {
    try {
      const snap = await col(name).limit(200).get();
      const items = snap.docs.map(normalizeDoc);
      return items
        .filter((it) => !it.deleted)
        .filter((it) =>
          fields.some((f) => String(it[f] || "").toLowerCase().includes(q))
        )
        .slice(0, limit);
    } catch (_) {
      return [];
    }
  };

  const [routes, stations, complaints, users, governorates, transport] = await Promise.all([
    searchIn("routes", ["name", "startPoint", "endPoint"]),
    searchIn("stations", ["name", "area", "governorate"]),
    searchIn("complaints", ["title", "description", "location"]),
    searchIn("users", ["name", "email", "phone"]),
    searchIn("governorates", ["name", "nameEn"]),
    searchIn("transportTypes", ["name", "slug"]),
  ]);

  return ok(res, { routes, stations, complaints, users, governorates, transport });
}));

/* =========================================================
   22. SYNC METADATA
   ========================================================= */

app.get("/api/sync/metadata", requireAuth, asyncHandler(async (req, res) => {
  const ref = col("syncMetadata").doc("global");
  const snap = await ref.get();
  if (!snap.exists) {
    return ok(res, {
      lastSync: null,
      counts: { complaints: 0, routes: 0, stations: 0 },
    });
  }
  const data = snap.data() || {};
  return ok(res, {
    lastSync: toIso(data.lastSync),
    counts: data.counts || {},
  });
}));

app.post("/api/sync/ack", requireAuth, requireCsrf, asyncHandler(async (req, res) => {
  await col("syncMetadata").doc("global").set(
    { lastSync: nowTs(), updatedAt: nowTs() },
    { merge: true }
  );
  return ok(res, { lastSync: new Date().toISOString() });
}));

/* =========================================================
   23. STATIC + PAGES
   ========================================================= */

const PUBLIC_DIR = path.join(__dirname, "public");

app.get("/", (req, res) => res.redirect("/login.html"));
app.get("/login", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "login.html")));
app.get("/dashboard", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "dashboard.html")));
app.get("/login.html", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "login.html")));
app.get("/dashboard.html", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "dashboard.html")));

app.use(express.static(PUBLIC_DIR, {
  maxAge: isProd ? "1y" : 0,
  immutable: isProd,
  index: false,
}));

app.use((req, res) => {
  if (req.path.startsWith("/api/")) return fail(res, 404, "المسار غير موجود");
  return res.status(404).sendFile(path.join(PUBLIC_DIR, "login.html"));
});

/* =========================================================
   24. ERROR HANDLER
   ========================================================= */

app.use((err, req, res, _next) => {
  const status = err instanceof ApiError ? err.status : (err.status || 500);
  const message =
    status >= 500 && isProd ? "حدث خطأ في الخادم" : (err.message || "حدث خطأ");

  console.error("[ERROR]", {
    path: req.path,
    method: req.method,
    status,
    message: err.message,
    stack: err.stack,
  });

  if (req.path.startsWith("/api/")) {
    return fail(res, status, message, err.code ? { code: err.code } : {});
  }
  return res.status(status).send(message);
});

/* =========================================================
   25. BOOTSTRAP
   ========================================================= */

const bootstrap = () => {
  validateEnv();
  initFirebase();
  initCloudinary();
};

bootstrap();

if (require.main === module) {
  app.listen(CONFIG.port, () => {
    console.log(`ALA FEEN? server running on port ${CONFIG.port} [${CONFIG.env}]`);
  });
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

module.exports = app;
