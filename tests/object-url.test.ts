import assert from "node:assert/strict";
import { mock, test } from "node:test";

import {
  createObjectUrlPreview,
  revokeObjectUrlPreview,
  revokeObjectUrlSet,
} from "@/lib/performance/urls";

test("createObjectUrlPreview creates blob previews and revokeObjectUrlSet cleans them up", () => {
  const createdUrls: string[] = [];
  const revokedUrls: string[] = [];
  const file = new File(["preview"], "preview.png", { type: "image/png" });

  const createObjectUrlMock = mock.method(URL, "createObjectURL", () => {
    const nextUrl = `blob:preview-${createdUrls.length + 1}`;
    createdUrls.push(nextUrl);
    return nextUrl;
  });
  const revokeObjectUrlMock = mock.method(URL, "revokeObjectURL", (url: string) => {
    revokedUrls.push(url);
  });

  const firstPreview = createObjectUrlPreview(file);
  const secondPreview = createObjectUrlPreview(file);

  assert.deepEqual(createdUrls, [firstPreview, secondPreview]);

  revokeObjectUrlSet(new Set([firstPreview, "https://compose.market/file.png", secondPreview]));

  assert.deepEqual(revokedUrls, [firstPreview, secondPreview]);

  createObjectUrlMock.mock.restore();
  revokeObjectUrlMock.mock.restore();
});

test("revokeObjectUrlPreview ignores non-blob URLs", () => {
  const revokedUrls: string[] = [];
  const revokeObjectUrlMock = mock.method(URL, "revokeObjectURL", (url: string) => {
    revokedUrls.push(url);
  });

  revokeObjectUrlPreview("https://compose.market/file.png");
  revokeObjectUrlPreview(undefined);
  revokeObjectUrlPreview("blob:kept");

  assert.deepEqual(revokedUrls, ["blob:kept"]);

  revokeObjectUrlMock.mock.restore();
});
