// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, mock, spyOn, test } from "bun:test";

import plugin from "../src/index.js";

type CapturedCliRegistration = {
    registrar?: (params: { program: FakeCommand }) => void;
    opts?: {
        commands?: string[];
        descriptors?: Array<{
            name: string;
            description: string;
            hasSubcommands?: boolean;
        }>;
    };
};

type CapturedReloadRegistration = {
    restartPrefixes?: string[];
    hotPrefixes?: string[];
    noopPrefixes?: string[];
};

class FakeCommand {
    subcommands = new Map<string, FakeCommand>();
    actionHandler?: (...args: string[]) => unknown | Promise<unknown>;

    constructor(readonly name = "root") {}

    command(spec: string) {
        const commandName = spec.split(" ")[0] ?? spec;
        const command = new FakeCommand(commandName);
        this.subcommands.set(commandName, command);
        return command;
    }

    description(_text: string) {
        return this;
    }

    action(handler: (...args: string[]) => unknown | Promise<unknown>) {
        this.actionHandler = handler;
        return this;
    }
}

function createApi(options?: {
    pluginConfig?: Record<string, unknown>;
    config?: Record<string, unknown>;
    registrationMode?: "full" | "cli-metadata" | "discovery" | "setup-only" | "setup-runtime";
}) {
    const tools: Array<{ name: string }> = [];
    const cliRegistrations: CapturedCliRegistration[] = [];
    const reloadRegistrations: CapturedReloadRegistration[] = [];
    const mode = options?.registrationMode ?? "full";

    return {
        tools,
        cliRegistrations,
        reloadRegistrations,
        api: {
            id: "a2a",
            name: "A2A Protocol",
            source: "test",
            registrationMode: mode,
            pluginConfig: options?.pluginConfig ?? {},
            config:
                options?.config ??
                ({
                    agents: {
                        defaults: {
                            workspace: "/tmp",
                        },
                    },
                } satisfies Record<string, unknown>),
            runtime:
                mode === "full"
                    ? {
                          state: {
                              resolveStateDir: () => "/tmp",
                          },
                          config: {
                              loadConfig: () => ({}),
                              writeConfigFile: async () => {},
                          },
                      }
                    : ({} as Record<string, never>),
            logger: {
                info() {},
                warn() {},
                error() {},
                debug() {},
            },
            registerTool(tool: { name: string }) {
                tools.push(tool);
            },
            registerCli(
                registrar: CapturedCliRegistration["registrar"],
                opts?: CapturedCliRegistration["opts"],
            ) {
                cliRegistrations.push({ registrar, opts });
            },
            registerReload(registration: CapturedReloadRegistration) {
                reloadRegistrations.push(registration);
            },
            registerHook() {},
            registerHttpRoute() {},
            registerChannel() {},
            registerGatewayMethod() {},
            registerService() {},
            registerNodeHostCommand() {},
            registerSecurityAuditCollector() {},
            registerConfigMigration() {},
            registerAutoEnableProbe() {},
            registerProvider() {},
            registerSpeechProvider() {},
            registerRealtimeTranscriptionProvider() {},
            registerRealtimeVoiceProvider() {},
            registerMediaUnderstandingProvider() {},
            registerImageGenerationProvider() {},
            registerMusicGenerationProvider() {},
            registerVideoGenerationProvider() {},
            registerWebFetchProvider() {},
            registerWebSearchProvider() {},
            registerInteractiveHandler() {},
            onConversationBindingResolved() {},
            registerCommand() {},
            registerContextEngine() {},
            registerMemoryPromptSection() {},
            registerMemoryPromptSupplement() {},
            registerMemoryCorpusSupplement() {},
            registerMemoryFlushPlan() {},
            registerMemoryRuntime() {},
            registerMemoryEmbeddingProvider() {},
            resolvePath(input: string) {
                return input;
            },
            on() {},
        },
    };
}

describe("plugin registration", () => {
    test("registers outbound tools with the current a2a-utils API shape", () => {
        const { api, tools } = createApi({
            pluginConfig: {
                outbound: {
                    agents: {
                        weather: {
                            url: "https://example.com/.well-known/agent-card.json",
                        },
                    },
                },
            },
        });

        plugin.register(api as never);

        expect(tools.map((tool) => tool.name)).toEqual([
            "a2a_get_agents",
            "a2a_get_agent",
            "a2a_send_message",
            "a2a_get_task",
            "a2a_view_text_artifact",
            "a2a_view_data_artifact",
        ]);
    });

    test("registers CLI metadata for the a2a root command", () => {
        const { api, cliRegistrations } = createApi();

        plugin.register(api as never);

        expect(cliRegistrations).toHaveLength(1);
        expect(cliRegistrations[0]?.opts?.descriptors).toEqual([
            {
                name: "a2a",
                description: "Manage A2A plugin keys and local configuration",
                hasSubcommands: true,
            },
        ]);
    });

    test("marks live agent-card config writes as no-op reloads", () => {
        const { api, reloadRegistrations } = createApi();

        plugin.register(api as never);

        expect(reloadRegistrations).toEqual([
            {
                noopPrefixes: ["plugins.entries.a2a.config.inbound.agentCard"],
            },
        ]);
    });

    test("revoke-key matches labels case-insensitively", async () => {
        const writeConfigFile = mock(async () => {});
        const { api, cliRegistrations } = createApi({
            config: {
                agents: {
                    defaults: {
                        workspace: "/tmp",
                    },
                },
            },
        });
        api.runtime.config.loadConfig = () => ({
            plugins: {
                entries: {
                    a2a: {
                        config: {
                            inbound: {
                                apiKeys: [
                                    { label: "Alice", key: "secret-1" },
                                    { label: "Bob", key: "secret-2" },
                                ],
                            },
                        },
                    },
                },
            },
        });
        api.runtime.config.writeConfigFile = writeConfigFile;

        plugin.register(api as never);

        const program = new FakeCommand();
        cliRegistrations[0]?.registrar?.({ program });
        const revokeCommand = program.subcommands.get("a2a")?.subcommands.get("revoke-key");
        expect(revokeCommand?.actionHandler).toBeDefined();

        const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
        try {
            await revokeCommand?.actionHandler?.("alice");
        } finally {
            consoleLogSpy.mockRestore();
        }

        expect(writeConfigFile).toHaveBeenCalledTimes(1);
        expect(writeConfigFile.mock.calls[0]?.[0]).toEqual({
            plugins: {
                entries: {
                    a2a: {
                        config: {
                            inbound: {
                                apiKeys: [{ label: "Bob", key: "secret-2" }],
                            },
                        },
                    },
                },
            },
        });
    });
});

describe("multi-agent inbound registration", () => {
    function createApiWithRoutes(options?: Parameters<typeof createApi>[0]) {
        const ctx = createApi(options);
        const routes: Array<{ path: string }> = [];
        const services: Array<{ id: string }> = [];
        ctx.api.registerHttpRoute = (route: { path: string }) => {
            routes.push(route);
        };
        ctx.api.registerService = (service: { id: string }) => {
            services.push(service);
        };
        return { ...ctx, routes, services };
    }

    test("registers per-agent /a2a/<agentId> routes for inbound.agents", () => {
        const { api, routes } = createApiWithRoutes({
            pluginConfig: {
                inbound: {
                    allowUnauthenticated: true,
                    agents: [{ agentId: "swe" }, { agentId: "pmo" }, { agentId: "ga" }],
                },
            },
        });
        plugin.register(api as never);
        const paths = routes.map((r) => r.path);
        expect(paths).toContain("/a2a/swe");
        expect(paths).toContain("/.well-known/agent-card-swe.json");
        expect(paths).toContain("/a2a/pmo");
        expect(paths).toContain("/.well-known/agent-card-pmo.json");
        expect(paths).toContain("/a2a/ga");
        expect(paths).toContain("/.well-known/agent-card-ga.json");
        expect(paths).not.toContain("/a2a");
        expect(paths).not.toContain("/.well-known/agent-card.json");
    });

    test("single-agent mode still registers /a2a (backward compat)", () => {
        const { api, routes } = createApiWithRoutes({
            pluginConfig: { inbound: { allowUnauthenticated: true } },
        });
        plugin.register(api as never);
        const paths = routes.map((r) => r.path);
        expect(paths).toContain("/a2a");
        expect(paths).toContain("/.well-known/agent-card.json");
        expect(paths).not.toContain("/a2a/swe");
    });

    test("multi-agent mode noopPrefixes reference inbound.agents", () => {
        const { api, reloadRegistrations } = createApiWithRoutes({
            pluginConfig: {
                inbound: {
                    allowUnauthenticated: true,
                    agents: [{ agentId: "swe" }],
                },
            },
        });
        plugin.register(api as never);
        expect(reloadRegistrations[0]?.noopPrefixes).toContain(
            "plugins.entries.a2a.config.inbound.agents",
        );
    });

    test("single-agent mode noopPrefixes reference inbound.agentCard", () => {
        const { api, reloadRegistrations } = createApiWithRoutes({
            pluginConfig: { inbound: { allowUnauthenticated: true } },
        });
        plugin.register(api as never);
        expect(reloadRegistrations[0]?.noopPrefixes).toContain(
            "plugins.entries.a2a.config.inbound.agentCard",
        );
    });
});

describe("OpenClaw registration mode compatibility", () => {
    test("cli-metadata mode registers CLI without accessing runtime", () => {
        const { api, cliRegistrations, tools } = createApi({
            registrationMode: "cli-metadata",
        });

        plugin.register(api as never);

        expect(cliRegistrations).toHaveLength(1);
        expect(cliRegistrations[0]?.opts?.descriptors).toEqual([
            {
                name: "a2a",
                description: "Manage A2A plugin keys and local configuration",
                hasSubcommands: true,
            },
        ]);
        expect(tools).toHaveLength(0);
    });

    test("cli-metadata mode with outbound config does not register tools", () => {
        const { api, tools, cliRegistrations } = createApi({
            registrationMode: "cli-metadata",
            pluginConfig: {
                outbound: {
                    agents: {
                        weather: {
                            url: "https://example.com/.well-known/agent-card.json",
                        },
                    },
                },
            },
        });

        plugin.register(api as never);

        expect(tools).toHaveLength(0);
        expect(cliRegistrations).toHaveLength(1);
    });

    test("discovery mode does not crash on empty runtime", () => {
        const { api } = createApi({
            registrationMode: "discovery",
        });

        expect(() => plugin.register(api as never)).not.toThrow();
    });

    test("setup-only mode does not crash on empty runtime", () => {
        const { api } = createApi({
            registrationMode: "setup-only",
        });

        expect(() => plugin.register(api as never)).not.toThrow();
    });
});
