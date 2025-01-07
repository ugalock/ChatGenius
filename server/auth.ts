import passport from "passport";
import { IVerifyOptions, Strategy as LocalStrategy } from "passport-local";
import { type Express } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { users, type SelectUser, insertUserSchema } from "@db/schema";
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
      64
    )) as Buffer;
    return timingSafeEqual(hashedPasswordBuf, suppliedPasswordBuf);
  },
};

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

// Create session store that can be exported
const MemoryStore = createMemoryStore(session);
export const sessionStore = new MemoryStore({
  checkPeriod: 86400000, // prune expired entries every 24h
  ttl: 86400000 * 7, // 7 days
});

// Export session settings for use in WebSocket
export const sessionSettings: session.SessionOptions = {
  secret: process.env.REPL_ID || "chat-genius-secret",
  resave: true,
  saveUninitialized: true,
  cookie: {
    maxAge: 86400000 * 7, // 7 days
    httpOnly: true,
    secure: false, // Will be set to true in production
    sameSite: 'lax',
    path: '/'
  },
  store: sessionStore,
  name: 'chat.sid',
  rolling: true // Refresh cookie on each request
};

export function setupAuth(app: Express) {
  // Set session settings based on environment
  if (app.get("env") === "production") {
    app.set("trust proxy", 1);
    sessionSettings.cookie!.secure = true;
  }

  // Setup session middleware before passport
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  // Add logging middleware to track session and auth state
  app.use((req, res, next) => {
    log(`[AUTH] Session ID: ${req.sessionID}, Authenticated: ${req.isAuthenticated()}, User: ${req.user?.id || 'none'}`);
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

        // Update user status to online
        await db
          .update(users)
          .set({ status: "online" })
          .where(eq(users.id, user.id));

        log(`[AUTH] Login successful: ${username}`);
        return done(null, user);
      } catch (err) {
        log(`[AUTH] Login error: ${err}`);
        return done(err);
      }
    })
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

  // Auth routes
  app.post("/api/register", async (req, res, next) => {
    try {
      const result = insertUserSchema.safeParse(req.body);
      if (!result.success) {
        log(`[AUTH] Registration validation failed: ${result.error.issues.map(i => i.message).join(", ")}`);
        return res
          .status(400)
          .send(
            "Invalid input: " + result.error.issues.map(i => i.message).join(", ")
          );
      }

      const { username, password } = result.data;
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
          status: "online"
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
          user: { id: newUser.id, username: newUser.username }
        });
      });
    } catch (error) {
      log(`[AUTH] Registration error: ${error}`);
      next(error);
    }
  });

  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: Express.User, info: IVerifyOptions) => {
      if (err) {
        log(`[AUTH] Login error: ${err}`);
        return next(err);
      }

      if (!user) {
        log(`[AUTH] Login failed: ${info.message}`);
        return res.status(400).send(info.message ?? "Login failed");
      }

      req.login(user, async (err) => {
        if (err) {
          log(`[AUTH] Login session creation failed: ${err}`);
          return next(err);
        }

        log(`[AUTH] Login successful: ${user.username}`);
        return res.json({
          message: "Login successful",
          user: { id: user.id, username: user.username }
        });
      });
    })(req, res, next);
  });

  app.post("/api/logout", async (req, res) => {
    if (req.user) {
      try {
        await db
          .update(users)
          .set({ status: "offline" })
          .where(eq(users.id, req.user.id));
        log(`[AUTH] User status set to offline: ${req.user.id}`);
      } catch (error) {
        log(`[AUTH] Error updating user status on logout: ${error}`);
      }
    }

    req.logout((err) => {
      if (err) {
        log(`[AUTH] Logout failed: ${err}`);
        return res.status(500).send("Logout failed");
      }
      log(`[AUTH] Logout successful`);
      res.json({ message: "Logout successful" });
    });
  });

  app.get("/api/user", (req, res) => {
    if (req.isAuthenticated()) {
      log(`[AUTH] User session verified: ${req.user.id}`);
      return res.json(req.user);
    }
    log(`[AUTH] Unauthorized access to /api/user`);
    res.status(401).end();
  });
}
