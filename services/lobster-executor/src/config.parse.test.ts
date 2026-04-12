import { describe, expect, it } from "vitest";

import { parseDockerHost } from "./config.js";

describe("parseDockerHost", () => {
  it("normalizes Windows npipe hosts into Dockerode socket paths", () => {
    expect(parseDockerHost("npipe:////./pipe/docker_engine")).toEqual({
      socketPath: "\\\\.\\pipe\\docker_engine",
    });
  });

  it("keeps unix socket paths as socketPath", () => {
    expect(parseDockerHost("/var/run/docker.sock")).toEqual({
      socketPath: "/var/run/docker.sock",
    });
  });

  it("parses tcp hosts into host and port fields", () => {
    expect(parseDockerHost("tcp://127.0.0.1:2375")).toEqual({
      host: "127.0.0.1",
      port: "2375",
      protocol: "http",
    });
  });
});
