if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "production";
}

await import("../dist/index.js");
