// Owner: R1. Task C-12: admin reset protection tests.
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { buildApp } from "../app";
import { ADMIN_RESET_HEADER } from "./admin";

function appWith(token: string, reset = vi.fn()) {
  return {
    reset,
    app: buildApp({ admin: { token, reset } }),
  };
}

describe("POST /api/admin/reset", () => {
  it("returns 401 when the header is missing", async () => {
    const { app, reset } = appWith("s3cret");
    const res = await request(app).post("/api/admin/reset");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
    expect(reset).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong token of the same length", async () => {
    const { app, reset } = appWith("s3cret");
    const res = await request(app).post("/api/admin/reset").set(ADMIN_RESET_HEADER, "s3cres");
    expect(res.status).toBe(401);
    expect(reset).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong token of a different length", async () => {
    const { app, reset } = appWith("s3cret");
    const res = await request(app)
      .post("/api/admin/reset")
      .set(ADMIN_RESET_HEADER, "s3cret-and-more");
    expect(res.status).toBe(401);
    expect(reset).not.toHaveBeenCalled();
  });

  it("reseeds and returns 200 for the correct token", async () => {
    const { app, reset } = appWith("s3cret");
    const res = await request(app).post("/api/admin/reset").set(ADMIN_RESET_HEADER, "s3cret");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("reset");
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("does not mount the route when no token is configured", async () => {
    const { app, reset } = appWith("");
    const res = await request(app).post("/api/admin/reset").set(ADMIN_RESET_HEADER, "");
    expect(res.status).toBe(404);
    expect(reset).not.toHaveBeenCalled();
  });
});
