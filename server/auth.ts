import passport from "passport";
import { IVerifyOptions, Strategy as LocalStrategy } from "passport-local";
import { type Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { users, type SelectUser } from "@db/schema";
import { db } from "@db";
import { eq } from "drizzle-orm";
import { log } from "./vite";

const scryptAsync = promisify(scrypt);
const crypto = {
  hash: async (password: string) => {
    const salt = randomBytes(16).toString("hex");
    const buf = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${buf.toString("hex")}.${salt}`;
  },
  compare: async (suppliedPassword: string, storedPassword: string) => {
    const [hashedPassword, salt] = storedPassword.split(".");
    const hashedPasswordBuf = Buffer.from(hashedPassword, "hex");
    const suppliedPasswordBuf = (await scryptAsync(
      suppliedPassword,
      salt,
      64,
    )) as Buffer;
    return timingSafeEqual(hashedPasswordBuf, suppliedPasswordBuf);
  },
};

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

const MemoryStore = createMemoryStore(session);
export const sessionStore = new MemoryStore({
  checkPeriod: 86400000, // Prune expired entries every 24h
  ttl: 86400000 * 30, // 30 days
  stale: false, // Delete expired sessions
  max: 1000, // Maximum number of sessions to store
  dispose: function(key) {
    log(`[AUTH] Session disposed: ${key}`);
  },
  noDisposeOnSet: true,
});

// Export session settings for WebSocket usage
export const sessionSettings: session.SessionOptions = {
  secret: process.env.REPL_ID || "chat-genius-secret",
  name: "chat.sid",
  cookie: {
    httpOnly: true,
    secure: false, // Will be set to true in production
    maxAge: 86400000 * 30, // 30 days
    path: '/',
    sameSite: 'lax'
  },
  store: sessionStore,
  saveUninitialized: false, // Don't create session until something stored
  resave: false, // Don't save session if unmodified
  unset: 'destroy', // Remove session from store when .destroy() is called
  rolling: true, // Force a new session identifier and reset expiration on every response
  proxy: true // Trust the reverse proxy
};

export function setupAuth(app: Express) {
  // Set secure cookies in production
  if (app.get("env") === "production") {
    app.set("trust proxy", 1);
    sessionSettings.cookie!.secure = true;
  }

  // Initialize session middleware first
  app.use(session(sessionSettings));

  // Initialize passport after session
  app.use(passport.initialize());
  app.use(passport.session());

  // Session debugging middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    log(`[AUTH] Request ${req.method} ${req.path}`);
    log(`[AUTH] Session ID: ${req.sessionID}`);
    log(`[AUTH] Is Authenticated: ${req.isAuthenticated()}`);
    log(`[AUTH] Cookie Header: ${req.headers.cookie}`);

    // Ensure proper cookie handling
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Save session before sending response
    if (req.session) {
      req.session.save((err) => {
        if (err) {
          log(`[AUTH] Error saving session: ${err}`);
        } else {
          log(`[AUTH] Session saved successfully`);
        }
      });
    }

    next();
  });

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.username, username))
          .limit(1);

        if (!user) {
          log(`[AUTH] Login failed: User not found - ${username}`);
          return done(null, false, { message: "Incorrect username." });
        }

        const isMatch = await crypto.compare(password, user.password);
        if (!isMatch) {
          log(`[AUTH] Login failed: Incorrect password - ${username}`);
          return done(null, false, { message: "Incorrect password." });
        }

        log(`[AUTH] Login successful: ${username}`);
        return done(null, user);
      } catch (err) {
        log(`[AUTH] Login error: ${err}`);
        return done(err);
      }
    }),
  );

  passport.serializeUser((user, done) => {
    log(`[AUTH] Serializing user: ${user.id}`);
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

      if (!user) {
        log(`[AUTH] Deserialize failed: User not found - ${id}`);
        return done(null, false);
      }

      log(`[AUTH] Deserialized user: ${user.id}`);
      done(null, user);
    } catch (err) {
      log(`[AUTH] Deserialize error: ${err}`);
      done(err);
    }
  });

  app.post("/api/register", async (req, res, next) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).send("Username and password are required");
      }

      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      if (existingUser) {
        log(`[AUTH] Registration failed: Username exists - ${username}`);
        return res.status(400).send("Username already exists");
      }

      const hashedPassword = await crypto.hash(password);
      const [newUser] = await db
        .insert(users)
        .values({
          username,
          password: hashedPassword,
        })
        .returning();

      log(`[AUTH] Registration successful: ${username}`);

      req.login(newUser, (err) => {
        if (err) {
          log(`[AUTH] Auto-login after registration failed: ${err}`);
          return next(err);
        }
        return res.json({
          message: "Registration successful",
          user: { id: newUser.id, username: newUser.username },
        });
      });
    } catch (error) {
      log(`[AUTH] Registration error: ${error}`);
      next(error);
    }
  });

  app.post("/api/login", (req, res, next) => {
    passport.authenticate(
      "local",
      (err: any, user: Express.User, info: IVerifyOptions) => {
        if (err) {
          log(`[AUTH] Login error: ${err}`);
          return next(err);
        }

        if (!user) {
          log(`[AUTH] Login failed: ${info.message}`);
          return res.status(400).send(info.message ?? "Login failed");
        }

        req.login(user, (err) => {
          if (err) {
            log(`[AUTH] Login session creation failed: ${err}`);
            return next(err);
          }

          // Save session immediately after login
          req.session!.save((err) => {
            if (err) {
              log(`[AUTH] Error saving session after login: ${err}`);
              return next(err);
            }

            log(`[AUTH] Login successful: ${user.username}`);
            return res.json({
              message: "Login successful",
              user: { id: user.id, username: user.username },
            });
          });
        });
      },
    )(req, res, next);
  });

  app.post("/api/logout", (req, res) => {
    if (req.user) {
      log(`[AUTH] Logging out user: ${req.user.id}`);
    }

    req.logout((err) => {
      if (err) {
        log(`[AUTH] Logout failed: ${err}`);
        return res.status(500).send("Logout failed");
      }

      req.session!.destroy((err) => {
        if (err) {
          log(`[AUTH] Error destroying session: ${err}`);
          return res.status(500).send("Logout failed");
        }

        res.clearCookie(sessionSettings.name!);
        log(`[AUTH] Logout successful`);
        res.json({ message: "Logout successful" });
      });
    });
  });

  app.get("/api/user", (req, res) => {
    if (req.isAuthenticated()) {
      log(`[AUTH] User session verified: ${req.user.id}`);
      return res.json(req.user);
    }
    log(`[AUTH] Unauthorized access to /api/user`);
    res.status(401).send("Not logged in");
  });
}