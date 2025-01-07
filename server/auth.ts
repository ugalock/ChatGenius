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
});

// Export session settings without cookie dependencies
export const sessionSettings: session.SessionOptions = {
  secret: process.env.REPL_ID || "chat-genius-secret",
  saveUninitialized: false,
  resave: false,
  store: sessionStore,
  cookie: false, // Disable cookies completely
};

// Map to store user tokens
const userTokens = new Map<string, number>();

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function setupAuth(app: Express) {
  // Initialize session middleware
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  // Debugging middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    log(`[AUTH] Request ${req.method} ${req.path}`);
    log(`[AUTH] Session ID: ${req.sessionID}`);
    log(`[AUTH] Is Authenticated: ${req.isAuthenticated()}`);
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

      const token = generateToken();
      userTokens.set(token, newUser.id);

      req.login(newUser, (err) => {
        if (err) {
          log(`[AUTH] Auto-login after registration failed: ${err}`);
          return next(err);
        }
        return res.json({
          message: "Registration successful",
          user: { id: newUser.id, username: newUser.username },
          token
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

          const token = generateToken();
          userTokens.set(token, user.id);

          log(`[AUTH] Login successful: ${user.username}`);
          return res.json({
            message: "Login successful",
            user: { id: user.id, username: user.username },
            token
          });
        });
      },
    )(req, res, next);
  });

  app.post("/api/logout", (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      userTokens.delete(token);
    }

    if (req.user) {
      log(`[AUTH] Logging out user: ${req.user.id}`);
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
    const token = req.headers.authorization?.split(' ')[1];
    if (token && userTokens.has(token)) {
      const userId = userTokens.get(token);
      if (userId) {
        db.select().from(users).where(eq(users.id, userId)).then(([user]) => {
          if (user) {
            return res.json(user);
          } else {
            log(`[AUTH] Unauthorized access to /api/user`);
            res.status(401).send("Not logged in");
          }
        });
      } else {
        log(`[AUTH] Unauthorized access to /api/user`);
        res.status(401).send("Not logged in");
      }
    } else {
      log(`[AUTH] Unauthorized access to /api/user`);
      res.status(401).send("Not logged in");
    }
  });
}

// Export token verification for WebSocket
export function verifyToken(token: string): number | null {
  return userTokens.get(token) || null;
}