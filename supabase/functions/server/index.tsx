import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import * as kv from "./kv_store.tsx";
import nodeAuthApi from "./node_auth_api.tsx";
import userApi from "./user_api.tsx";
import aiProxy from "./ai_proxy.tsx"; // Import the new AI proxy function

const app = new Hono();

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    credentials: true,  // 允许凭据
    maxAge: 600,
  }),
);

// Register the node and auth APIs
app.route('/make-server-1334fc59', nodeAuthApi);
app.route('/make-server-1334fc59', userApi);

// Register the AI proxy API separately to make it accessible at its own route
app.route('/make-server-1334fc59', aiProxy);

// Health check endpoint
app.get("/make-server-1334fc59/health", (c) => {
  return c.json({ status: "ok" });
});

// Get all tasks
app.get("/make-server-1334fc59/tasks", async (c) => {
  try {
    const tasks = await kv.getByPrefix("task:");
    return c.json({ tasks: tasks || [] });
  } catch (error) {
    console.log(`Error fetching tasks: ${error}`);
    return c.json({ error: "Failed to fetch tasks", details: String(error) }, 500);
  }
});

// Create a new task
app.post("/make-server-1334fc59/tasks", async (c) => {
  try {
    const task = await c.req.json();
    await kv.set(`task:${task.id}`, task);
    return c.json({ success: true, task });
  } catch (error) {
    console.log(`Error creating task: ${error}`);
    return c.json({ error: "Failed to create task", details: String(error) }, 500);
  }
});

// Update a task
app.put("/make-server-1334fc59/tasks/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const updates = await c.req.json();
    const existing = await kv.get(`task:${id}`);

    if (!existing) {
      return c.json({ error: "Task not found" }, 404);
    }

    const updated = { ...existing, ...updates };
    await kv.set(`task:${id}`, updated);
    return c.json({ success: true, task: updated });
  } catch (error) {
    console.log(`Error updating task: ${error}`);
    return c.json({ error: "Failed to update task", details: String(error) }, 500);
  }
});

// Delete a task
app.delete("/make-server-1334fc59/tasks/:id", async (c) => {
  try {
    const id = c.req.param("id");
    await kv.del(`task:${id}`);
    return c.json({ success: true });
  } catch (error) {
    console.log(`Error deleting task: ${error}`);
    return c.json({ error: "Failed to delete task", details: String(error) }, 500);
  }
});

Deno.serve(app.fetch);