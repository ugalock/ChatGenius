import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupAuth } from "./auth";
import { setupVite, serveStatic, log } from "./vite";
import cors from "cors";
import { db } from "@db";
import { createServer } from "net";

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

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = createServer()
      .once('error', () => {
        resolve(false);
      })
      .once('listening', () => {
        tester.once('close', () => {
          resolve(true);
        }).close();
      })
      .listen(port, '0.0.0.0');
  });
}

let serverInstance: ReturnType<typeof registerRoutes> | null = null;

async function startServer() {
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
    try {
      serverInstance = registerRoutes(app);
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
        await setupVite(app, serverInstance);
        log("Vite setup completed");
      } else {
        serveStatic(app);
        log("Static serving completed");
      }
    } catch (setupError) {
      log(`Frontend setup failed: ${setupError}`);
      process.exit(1);
    }

    const PORT = 5000;

    // Check if port is available
    const isAvailable = await isPortAvailable(PORT);
    if (!isAvailable) {
      log(`Port ${PORT} is already in use. Please free up the port and try again.`);
      process.exit(1);
    }

    // Start server
    serverInstance.listen(PORT, "0.0.0.0", () => {
      log(`Server started successfully on port ${PORT}`);
    });

    // Handle graceful shutdown
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

  } catch (error) {
    log(`[FATAL] Server failed to start: ${error}`);
    process.exit(1);
  }
}

// Graceful shutdown handler
async function gracefulShutdown() {
  log('Received shutdown signal. Starting graceful shutdown...');

  try {
    // Close server first
    if (serverInstance) {
      await new Promise((resolve) => {
        serverInstance!.close(() => {
          log('Server closed');
          resolve(undefined);
        });
      });
    }

    // For Drizzle ORM, we don't need to explicitly close the connection
    // as it uses serverless connections that are automatically managed
    log('Database connections will be automatically closed');

    log('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    log(`Error during shutdown: ${error}`);
    process.exit(1);
  }
}

// Start the server
startServer();