import passport from "passport";
import { IVerifyOptions, Strategy as LocalStrategy } from "passport-local";
import { type Express, Request, Response, NextFunction } from "express";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { users, type SelectUser } from "@db/schema";
import { db } from "@db";
import { eq } from "drizzle-orm";
import { log } from "./vite";
import jwt from "jsonwebtoken";

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

// JWT Configuration
const JWT_SECRET =
  process.env.JWT_SECRET || process.env.REPL_ID || "chat-genius-secret";
const JWT_EXPIRES_IN = "30d";

function generateJWT(userId: number): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyJWT(token: string): number | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
    return decoded.userId;
  } catch (err) {
    log(`[AUTH] JWT verification failed: ${err}`);
    return null;
  }
}

// Middleware to verify JWT
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];
  const userId = verifyJWT(token);
  if (!userId) {
    return res.status(401).json({ message: "Invalid token" });
  }

  // Add userId to request for use in routes
  req.user = { id: userId } as Express.User;
  next();
}

export function setupAuth(app: Express) {
  // Initialize passport for local strategy
  app.use(passport.initialize());

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

      // Generate JWT token
      const token = generateJWT(newUser.id);

      return res.json({
        message: "Registration successful",
        user: { id: newUser.id, username: newUser.username },
        token,
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

        // Generate JWT token
        const token = generateJWT(user.id);

        log(`[AUTH] Login successful: ${user.username}`);
        return res.json({
          message: "Login successful",
          user: { id: user.id, username: user.username },
          token,
        });
      },
    )(req, res, next);
  });

  app.get("/api/user", requireAuth, async (req, res) => {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Don't send password hash
      const { password, ...userWithoutPassword } = user;
      return res.json(userWithoutPassword);
    } catch (error) {
      log(`[AUTH] Error fetching user: ${error}`);
      res.status(500).json({ message: "Internal server error" });
    }
  });
}

// Export JWT verification for WebSocket
export function verifyAuthToken(token: string): number | null {
  return verifyJWT(token);
}
