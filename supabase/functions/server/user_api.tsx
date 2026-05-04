import { Hono } from "npm:hono";
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";
import * as kv from "./kv_store.tsx";

const app = new Hono();

// 初始化Supabase客户端
const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// GET /user/api/events - 获取用户事件列表
app.get("/user/api/events", async (c) => {
    try {
        // 尝试从KV存储获取事件数据
        const storedEvents = await kv.getByPrefix("event:");

        if (storedEvents && storedEvents.length > 0) {
            // 按时间戳排序，最新的在前
            const sortedEvents = storedEvents.sort((a, b) => {
                const timeA = new Date(a.timestamp || 0).getTime();
                const timeB = new Date(b.timestamp || 0).getTime();
                return timeB - timeA;
            });

            return c.json(sortedEvents);
        }

        // 如果KV中没有数据，返回示例数据
        const sampleEvents = [
            {
                type: "starred",
                user: "Jack Mordan",
                action: "starred projects",
                time: "15 minutes ago",
                avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop",
                repo: {
                    name: "awesome-react-components",
                    description: "A collection of awesome React components for modern web applications",
                    lastUpdate: "Recently update on 15 minutes ago"
                },
                timestamp: new Date().toISOString()
            },
            {
                type: "forked",
                user: "Sarah Chen",
                action: "forked repository",
                time: "1 hour ago",
                avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop",
                repo: {
                    name: "web-performance-toolkit",
                    description: "Tools and utilities for optimizing web application performance",
                    lastUpdate: "Recently update on 1 hour ago"
                },
                timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString()
            },
            {
                type: "created",
                user: "Mike Johnson",
                action: "created repository",
                time: "2 hours ago",
                avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop",
                repo: {
                    name: "api-gateway",
                    description: "Scalable API gateway with authentication and rate limiting",
                    lastUpdate: "Recently update on 2 hours ago"
                },
                timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
            }
        ];

        return c.json(sampleEvents);
    } catch (error) {
        console.error("Error fetching events:", error);
        return c.json({
            error: "Failed to fetch events",
            details: String(error)
        }, 500);
    }
});

// GET /user/api/commits - 获取提交记录列表
app.get("/user/api/commits", async (c) => {
    try {
        // 尝试从KV存储获取提交数据
        const storedCommits = await kv.getByPrefix("commit:");

        if (storedCommits && storedCommits.length > 0) {
            // 按时间戳排序，最新的在前
            const sortedCommits = storedCommits.sort((a, b) => {
                const timeA = new Date(a.timestamp || 0).getTime();
                const timeB = new Date(b.timestamp || 0).getTime();
                return timeB - timeA;
            });

            return c.json(sortedCommits);
        }

        // 如果KV中没有数据，返回示例数据
        const sampleCommits = [
            {
                hash: "a3f2d91",
                message: "feat: add user authentication flow",
                time: "25 minutes ago",
                branch: "main branch of jackmordan/web-app",
                timestamp: new Date(Date.now() - 25 * 60 * 1000).toISOString()
            },
            {
                hash: "b7e4c82",
                message: "fix: resolve avatar upload issue",
                time: "35 minutes ago",
                branch: "main branch of jackmordan/web-app",
                timestamp: new Date(Date.now() - 35 * 60 * 1000).toISOString()
            },
            {
                hash: "c9d1a54",
                message: "refactor: improve profile component structure",
                time: "1 hour ago",
                branch: "main branch of jackmordan/web-app",
                timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString()
            },
            {
                hash: "d2e8f37",
                message: "docs: update README with installation instructions",
                time: "2 hours ago",
                branch: "main branch of jackmordan/web-app",
                timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
            },
            {
                hash: "e5b3c91",
                message: "style: apply consistent formatting across components",
                time: "3 hours ago",
                branch: "main branch of jackmordan/web-app",
                timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
            }
        ];

        return c.json(sampleCommits);
    } catch (error) {
        console.error("Error fetching commits:", error);
        return c.json({
            error: "Failed to fetch commits",
            details: String(error)
        }, 500);
    }
});

// POST /user/api/events - 创建新事件（用于记录用户操作）
app.post("/user/api/events", async (c) => {
    try {
        const eventData = await c.req.json();

        // 生成唯一ID
        const eventId = `event:${Date.now()}-${crypto.randomUUID()}`;

        // 添加时间戳
        const event = {
            ...eventData,
            timestamp: new Date().toISOString()
        };

        // 存储到KV
        await kv.set(eventId, event);

        return c.json({
            success: true,
            eventId: eventId,
            event: event
        });
    } catch (error) {
        console.error("Error creating event:", error);
        return c.json({
            error: "Failed to create event",
            details: String(error)
        }, 500);
    }
});

// POST /user/api/commits - 创建新提交记录
app.post("/user/api/commits", async (c) => {
    try {
        const commitData = await c.req.json();

        // 生成唯一ID
        const commitId = `commit:${Date.now()}-${crypto.randomUUID()}`;

        // 添加时间戳
        const commit = {
            ...commitData,
            timestamp: new Date().toISOString()
        };

        // 存储到KV
        await kv.set(commitId, commit);

        return c.json({
            success: true,
            commitId: commitId,
            commit: commit
        });
    } catch (error) {
        console.error("Error creating commit:", error);
        return c.json({
            error: "Failed to create commit",
            details: String(error)
        }, 500);
    }
});

export default app;
