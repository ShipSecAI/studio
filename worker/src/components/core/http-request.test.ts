import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { definition } from "./http-request";
import type { ExecutionContext } from "@shipsec/component-sdk";

// Helper to create a dummy context
const mockContext: ExecutionContext = {
  runId: "test-run",
  componentRef: "test-node",
  metadata: { workflowId: "test-wf", executionId: "test-exec" },
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
  emitProgress: () => {},
};

describe("HTTP Request Component", () => {
  let server: any;
  const port = 3000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://localhost:${port}`;

  beforeAll(() => {
    // Start a simple server using Bun.serve
    server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/json" && req.method === "POST") {
          const body = await req.json();
          return Response.json({ received: body, headers: Object.fromEntries(req.headers) });
        }

        if (url.pathname === "/status/404") {
          return new Response("Not Found", { status: 404 });
        }
        
        if (url.pathname === "/status/500") {
             return new Response("Server Error", { status: 500 });
        }

        if (url.pathname === "/text") {
            return new Response("Hello World", { 
                headers: { "Content-Type": "text/plain" } 
            });
        }
        
        if (url.pathname === "/headers") {
             return Response.json({ headers: Object.fromEntries(req.headers) });
        }
        
        if (url.pathname === "/delete" && req.method === "DELETE") {
             return Response.json({ deleted: true });
        }

        if (url.pathname === "/timeout") {
            // Sleep for 200ms
             await new Promise(r => setTimeout(r, 200));
             return new Response("Finally");
        }

        return new Response("OK");
      },
    });
  });

  afterAll(() => {
    server.stop();
  });

  test("should handle basic GET request", async () => {
    const result = await definition.execute(
      {
        url: `${baseUrl}/`,
        method: "GET",
        headers: {},
        contentType: "application/json",
        timeout: 1000,
        failOnError: true,
      },
      mockContext
    );

    expect(result.status).toBe(200);
    expect(result.rawBody).toBe("OK");
  });

  test("should handle POST with JSON body", async () => {
    const payload = JSON.stringify({ foo: "bar" });
    const result = await definition.execute(
      {
        url: `${baseUrl}/json`,
        method: "POST",
        body: payload,
        headers: { "X-Test": "123" },
        contentType: "application/json",
        timeout: 1000,
        failOnError: true,
      },
      mockContext
    );

    expect(result.status).toBe(200);
    // Since output keys are typed as unknown, we cast for testing
    const data = result.data as any;
    expect(data.received).toEqual({ foo: "bar" });
    expect(data.headers["x-test"]).toBe("123");
    expect(data.headers["content-type"]).toBe("application/json");
  });
  
  test("should parse text response correctly", async () => {
      const result = await definition.execute(
        {
          url: `${baseUrl}/text`,
          method: "GET",
          timeout: 1000,
          contentType: "application/json",
          failOnError: true,
        },
        mockContext
      );
  
      expect(result.status).toBe(200);
      expect(result.rawBody).toBe("Hello World");
      // Should not try to parse "Hello World" as JSON
      expect(result.data).toBe("Hello World");
  });

  test("should handle DELETE method", async () => {
      const result = await definition.execute(
        {
          url: `${baseUrl}/delete`,
          method: "DELETE",
          timeout: 1000,
          contentType: "application/json",
          failOnError: true,
        },
        mockContext
      );
      expect(result.status).toBe(200);
      expect((result.data as any).deleted).toBe(true);
  });

  test("should throw on 404 if failOnError is true", async () => {
    try {
      await definition.execute(
        {
          url: `${baseUrl}/status/404`,
          method: "GET",
          failOnError: true,
          contentType: "application/json",
          timeout: 1000,
        },
        mockContext
      );
      expect(true).toBe(false); // Should fail if reached
    } catch (e: any) {
      expect(e.message).toContain("HTTP Request Failed: 404");
    }
  });

  test("should return status 404 if failOnError is false", async () => {
     const result = await definition.execute(
        {
          url: `${baseUrl}/status/404`,
          method: "GET",
          failOnError: false, // Don't throw
          contentType: "application/json",
          timeout: 1000,
        },
        mockContext
      );
      expect(result.status).toBe(404);
      expect(result.statusText).toBe("Not Found");
  });

  test("should timeout if request takes too long", async () => {
    try {
        await definition.execute(
          {
            url: `${baseUrl}/timeout`,
            method: "GET",
            timeout: 50, // Server sleeps for 200ms
            contentType: "application/json",
            failOnError: true,
          },
          mockContext
        );
        expect(true).toBe(false); 
      } catch (e: any) {
        expect(e.message).toContain("timed out");
      }
  });
});
