import { z } from "zod";

const configurationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

export const configurationScopeSchema = z.enum(["user", "team", "project"]);
export const mcpTransportSchema = z.enum(["stdio", "streamable-http"]);

const stringMapSchema = z.record(z.string().trim().min(1).max(160), z.string().max(8_000));

export const mcpServerConfigurationSchema = z
  .object({
    args: z.array(z.string().max(2_000)).max(100),
    command: z.string().trim().max(2_000).nullable(),
    enabled: z.boolean(),
    env: stringMapSchema,
    headers: stringMapSchema,
    id: configurationIdSchema,
    name: z.string().trim().min(1).max(120),
    scope: configurationScopeSchema,
    transport: mcpTransportSchema,
    url: z.string().trim().max(2_000).nullable(),
  })
  .strict()
  .superRefine((server, context) => {
    if (server.transport === "stdio" && (server.command?.length ?? 0) === 0) {
      context.addIssue({
        code: "custom",
        message: "stdio 服务必须填写 command。",
        path: ["command"],
      });
    }
    if (server.transport === "streamable-http") {
      if ((server.url?.length ?? 0) === 0) {
        context.addIssue({
          code: "custom",
          message: "Streamable HTTP 服务必须填写 url。",
          path: ["url"],
        });
      } else {
        try {
          new URL(server.url ?? "");
        } catch {
          context.addIssue({
            code: "custom",
            message: "url 必须是有效地址。",
            path: ["url"],
          });
        }
      }
    }
  });

export const skillConfigurationSchema = z
  .object({
    description: z.string().trim().max(500),
    enabled: z.boolean(),
    entryPath: z.string().trim().min(1).max(2_000),
    id: configurationIdSchema,
    mcpDependencies: z.array(configurationIdSchema).max(50),
    name: z.string().trim().min(1).max(120),
    scope: configurationScopeSchema,
    version: z.string().trim().max(80),
  })
  .strict();

function uniqueIds<T extends { id: string }>(items: T[], context: z.RefinementCtx): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      context.addIssue({
        code: "custom",
        message: `配置 ID ${item.id} 重复。`,
        path: [index, "id"],
      });
    }
    seen.add(item.id);
  });
}

export const mcpServerConfigurationListSchema = z
  .array(mcpServerConfigurationSchema)
  .max(200)
  .superRefine(uniqueIds);

export const skillConfigurationListSchema = z
  .array(skillConfigurationSchema)
  .max(500)
  .superRefine(uniqueIds);

const skillDirectoryListSchema = z
  .array(z.string().trim().min(1).max(32_767))
  .max(50)
  .superRefine((directories, context) => {
    const seen = new Set<string>();
    directories.forEach((directory, index) => {
      const key = directory.toLocaleLowerCase("en-US");
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          message: `Skill 目录 ${directory} 重复。`,
          path: [index],
        });
      }
      seen.add(key);
    });
  });

export const integrationConfigurationSchema = z
  .object({
    mcpServers: mcpServerConfigurationListSchema,
    skillDirectories: skillDirectoryListSchema.default([]),
    skills: skillConfigurationListSchema,
    version: z.literal(1),
  })
  .strict();

export type ConfigurationScope = z.infer<typeof configurationScopeSchema>;
export type McpServerConfiguration = z.infer<typeof mcpServerConfigurationSchema>;
export type McpTransport = z.infer<typeof mcpTransportSchema>;
export type SkillConfiguration = z.infer<typeof skillConfigurationSchema>;
export type IntegrationConfiguration = z.infer<typeof integrationConfigurationSchema>;
