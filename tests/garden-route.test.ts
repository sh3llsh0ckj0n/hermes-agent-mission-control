import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { PUT } from "../src/app/api/garden/route";

test("public garden mutation is rejected before contacting the backing service", async () => {
  const previousInternalSecret = process.env.INTERNAL_API_SECRET;
  const previousNextAuthSecret = process.env.NEXTAUTH_SECRET;
  const previousBlobUrl = process.env.GARDEN_BLOB_URL;

  delete process.env.INTERNAL_API_SECRET;
  process.env.NEXTAUTH_SECRET = "test-only-nextauth-secret";
  process.env.GARDEN_BLOB_URL = "https://example.invalid/garden";

  try {
    const request = new NextRequest("http://localhost/api/garden", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plants: [] }),
    });
    const response = await PUT(request);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
  } finally {
    if (previousInternalSecret === undefined) delete process.env.INTERNAL_API_SECRET;
    else process.env.INTERNAL_API_SECRET = previousInternalSecret;
    if (previousNextAuthSecret === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = previousNextAuthSecret;
    if (previousBlobUrl === undefined) delete process.env.GARDEN_BLOB_URL;
    else process.env.GARDEN_BLOB_URL = previousBlobUrl;
  }
});
