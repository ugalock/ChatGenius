import passport from "passport";
import { IVerifyOptions, Strategy as LocalStrategy } from "passport-local";
import { type Express } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { users, type User } from "@db/schema";
import { db } from "@db";
import { eq } from "drizzle-orm";

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
    interface User extends User {}
  }
}

export function setupAuth(app: Express) {
  const MemoryStore = createMemoryStore(session);
  const sessionSettings: session.SessionOptions = {
    secret: process.env.REPL_ID || "chat-genius-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 86400000, // 24 hours
      httpOnly: true,
      sameSite: 'lax'
    },
    store: new MemoryStore({
      checkPeriod: 86400000, // prune expired entries every 24h
    }),
  };

  if (app.get("env") === "production") {
    app.set("trust proxy", 1);
    sessionSettings.cookie = {
      ...sessionSettings.cookie,
      secure: true,
    };
  }

  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  // Add debug middleware
  app.use((req, res, next) => {
    console.log(`[AUTH] ${req.method} ${req.path} - isAuthenticated: ${req.isAuthenticated()}`);
    next();
  });

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        console.log("[AUTH] Attempting login for user:", username);
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.username, username))
          .limit(1);

        if (!user) {
          console.log("[AUTH] User not found:", username);
          return done(null, false, { message: "Incorrect username." });
        }
        const isMatch = await crypto.compare(password, user.password);
        if (!isMatch) {
          console.log("[AUTH] Password mismatch for user:", username);
          return done(null, false, { message: "Incorrect password." });
        }
        console.log("[AUTH] Login successful for user:", username);
        return done(null, user);
      } catch (err) {
        console.error("[AUTH] Login error:", err);
        return done(err);
      }
    })
  );

  passport.serializeUser((user, done) => {
    console.log("[AUTH] Serializing user:", user.id);
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      console.log("[AUTH] Deserializing user:", id);
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      done(null, user);
    } catch (err) {
      console.error("[AUTH] Deserialization error:", err);
      done(err);
    }
  });

  app.post("/api/register", async (req, res, next) => {
    try {
      const { username, password } = req.body;
      console.log("[AUTH] Registration attempt for user:", username);

      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      if (existingUser) {
        console.log("[AUTH] Registration failed - username exists:", username);
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

      console.log("[AUTH] Registration successful for user:", username);

      req.login(newUser, (err) => {
        if (err) {
          return next(err);
        }
        return res.json({
          message: "Registration successful",
          user: { id: newUser.id, username: newUser.username },
        });
      });
    } catch (error) {
      console.error("[AUTH] Registration error:", error);
      next(error);
    }
  });

  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", async (err: any, user: Express.User, info: IVerifyOptions) => {
      if (err) {
        console.error("[AUTH] Login error:", err);
        return next(err);
      }

      if (!user) {
        console.log("[AUTH] Login failed:", info.message);
        return res.status(400).send(info.message ?? "Login failed");
      }

      req.logIn(user, async (err) => {
        if (err) {
          console.error("[AUTH] Login error during session creation:", err);
          return next(err);
        }

        await db
          .update(users)
          .set({ status: "online" })
          .where(eq(users.id, user.id));

        console.log("[AUTH] Login successful for user:", user.username);
        return res.json({
          message: "Login successful",
          user: { id: user.id, username: user.username },
        });
      });
    })(req, res, next);
  });

  app.post("/api/logout", async (req, res) => {
    if (req.user) {
      console.log("[AUTH] Logging out user:", req.user.username);
      await db
        .update(users)
        .set({ status: "offline" })
        .where(eq(users.id, req.user.id));
    }

    req.logout((err) => {
      if (err) {
        console.error("[AUTH] Logout error:", err);
        return res.status(500).send("Logout failed");
      }
      console.log("[AUTH] Logout successful");
      res.json({ message: "Logout successful" });
    });
  });

  app.get("/api/user", (req, res) => {
    console.log("[AUTH] User check - isAuthenticated:", req.isAuthenticated());
    if (req.isAuthenticated()) {
      return res.json(req.user);
    }
    res.status(401).send("Not logged in");
  });
}