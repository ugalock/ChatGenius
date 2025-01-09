import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupAuth } from "./auth";
import { setupVite, serveStatic, log } from "./vite";
import cors from "cors";
import { db } from "@db";

const app = express();

// Basic middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Configure CORS
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

(async () => {
  try {
    log("Starting server initialization...");

    // Setup authentication
    try {
      setupAuth(app);
      log("Authentication setup successful");
    } catch (authError) {
      log(`Authentication setup failed: ${authError}`);
      process.exit(1);
    }

    // Debug middleware for request logging
    app.use((req, res, next) => {
      const start = Date.now();
      const path = req.path;
      let capturedJsonResponse: Record<string, any> | undefined = undefined;

      const originalResJson = res.json;
      res.json = function (bodyJson, ...args) {
        capturedJsonResponse = bodyJson;
        return originalResJson.apply(res, [bodyJson, ...args]);
      };

      res.on("finish", () => {
        const duration = Date.now() - start;
        if (path.startsWith("/api")) {
          let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
          if (capturedJsonResponse) {
            logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
          }

          if (logLine.length > 80) {
            logLine = logLine.slice(0, 79) + "…";
          }

          log(logLine);
        }
      });

      next();
    });

    // Register routes and get server instance
    let server;
    try {
      server = registerRoutes(app);
      log("Routes registered successfully");
    } catch (routesError) {
      log(`Routes registration failed: ${routesError}`);
      process.exit(1);
    }

    // Error handling middleware
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      log(`[ERROR] ${status}: ${message}`);
      res.status(status).json({ message });
    });

    // Setup Vite or static serving
    try {
      if (app.get("env") === "development") {
        await setupVite(app, server);
        log("Vite setup completed");
      } else {
        serveStatic(app);
        log("Static serving setup completed");
      }
    } catch (setupError) {
      log(`Frontend setup failed: ${setupError}`);
      process.exit(1);
    }

    // ALWAYS serve the app on port 5000
    // this serves both the API and the client
    const PORT = 5000;
    server.listen(PORT, "0.0.0.0", () => {
      log(`Server started successfully on port ${PORT}`);
    });
  } catch (error) {
    log(`[FATAL] Server failed to start: ${error}`);
    process.exit(1);
  }
})();