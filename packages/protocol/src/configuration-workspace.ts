import { z } from "zod";

const MAX_CONFIGURATION_ID_LENGTH = 80;
const MAX_ENTRY_NAME_LENGTH = 255;
const MAX_PATH_LENGTH = 32_767;
const MAX_FILE_CONTENT_LENGTH = 2_100_000;

function isSafeRelativePath(value: string): boolean {
  if (value.length === 0) return true;
  return (
    !value.startsWith("/")
    && !value.includes("\\")
    && !value.includes("\u0000")
    && value.split("/").every((segment) =>
      segment.length > 0 && segment !== "." && segment !== ".."
    )
  );
}

const configurationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_CONFIGURATION_ID_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

export const configurationWorkspaceKindSchema = z.enum(["mcp", "skill"]);

export const relativeConfigurationWorkspacePathSchema = z
  .string()
  .max(MAX_PATH_LENGTH)
  .refine(isSafeRelativePath, {
    message: "Configuration workspace paths must be relative POSIX paths inside the workspace root.",
  });

const configurationWorkspaceReferenceSchema = z
  .object({
    configurationId: configurationIdSchema,
    kind: configurationWorkspaceKindSchema,
  })
  .strict();

export const configurationWorkspaceReferenceInputSchema =
  configurationWorkspaceReferenceSchema;

export const configurationWorkspaceEntryKindSchema = z.enum([
  "directory",
  "file",
  "symlink",
]);

export const configurationWorkspaceEntrySchema = z
  .object({
    isProtected: z.boolean(),
    kind: configurationWorkspaceEntryKindSchema,
    modifiedAt: z.string().datetime().optional(),
    name: z.string().trim().min(1).max(MAX_ENTRY_NAME_LENGTH),
    path: relativeConfigurationWorkspacePathSchema,
  })
  .strict();

export const listConfigurationWorkspaceEntriesInputSchema =
  configurationWorkspaceReferenceSchema.extend({
    directoryPath: relativeConfigurationWorkspacePathSchema,
  }).strict();

export const configurationWorkspaceDirectoryListingSchema = z
  .object({
    configurationId: configurationIdSchema,
    directoryPath: relativeConfigurationWorkspacePathSchema,
    entries: z.array(configurationWorkspaceEntrySchema),
    kind: configurationWorkspaceKindSchema,
    rootPath: z.string().trim().min(1).max(MAX_PATH_LENGTH),
    truncated: z.boolean(),
  })
  .strict();

export const readConfigurationWorkspaceFileInputSchema =
  configurationWorkspaceReferenceSchema.extend({
    path: relativeConfigurationWorkspacePathSchema.refine((value) => value.length > 0, {
      message: "A configuration workspace file path is required.",
    }),
  }).strict();

export const configurationWorkspaceFileSchema = z
  .object({
    byteLength: z.number().int().nonnegative(),
    configurationId: configurationIdSchema,
    content: z.string().max(MAX_FILE_CONTENT_LENGTH).nullable(),
    isBinary: z.boolean(),
    isProtected: z.boolean(),
    kind: configurationWorkspaceKindSchema,
    name: z.string().trim().min(1).max(MAX_ENTRY_NAME_LENGTH),
    path: relativeConfigurationWorkspacePathSchema,
    truncated: z.boolean(),
  })
  .strict();

export const createConfigurationWorkspaceEntryInputSchema =
  configurationWorkspaceReferenceSchema.extend({
    entryKind: z.enum(["directory", "file"]),
    path: relativeConfigurationWorkspacePathSchema
      .refine((value) => value.length > 0, {
        message: "A configuration workspace entry path is required.",
      })
      .refine((value) => (value.split("/").at(-1)?.length ?? 0) <= MAX_ENTRY_NAME_LENGTH, {
        message: "The configuration workspace entry name is too long.",
      }),
  }).strict();

export const writeConfigurationWorkspaceFileInputSchema =
  configurationWorkspaceReferenceSchema.extend({
    content: z.string().max(MAX_FILE_CONTENT_LENGTH),
    path: relativeConfigurationWorkspacePathSchema.refine((value) => value.length > 0, {
      message: "A configuration workspace file path is required.",
    }),
  }).strict();

export const deleteConfigurationWorkspaceEntryInputSchema =
  configurationWorkspaceReferenceSchema.extend({
    path: relativeConfigurationWorkspacePathSchema.refine((value) => value.length > 0, {
      message: "A configuration workspace entry path is required.",
    }),
  }).strict();

export type ConfigurationWorkspaceKind = z.infer<typeof configurationWorkspaceKindSchema>;
export type ConfigurationWorkspaceReferenceInput = z.infer<
  typeof configurationWorkspaceReferenceInputSchema
>;
export type ConfigurationWorkspaceEntry = z.infer<typeof configurationWorkspaceEntrySchema>;
export type ListConfigurationWorkspaceEntriesInput = z.infer<
  typeof listConfigurationWorkspaceEntriesInputSchema
>;
export type ConfigurationWorkspaceDirectoryListing = z.infer<
  typeof configurationWorkspaceDirectoryListingSchema
>;
export type ReadConfigurationWorkspaceFileInput = z.infer<
  typeof readConfigurationWorkspaceFileInputSchema
>;
export type ConfigurationWorkspaceFile = z.infer<typeof configurationWorkspaceFileSchema>;
export type CreateConfigurationWorkspaceEntryInput = z.infer<
  typeof createConfigurationWorkspaceEntryInputSchema
>;
export type WriteConfigurationWorkspaceFileInput = z.infer<
  typeof writeConfigurationWorkspaceFileInputSchema
>;
export type DeleteConfigurationWorkspaceEntryInput = z.infer<
  typeof deleteConfigurationWorkspaceEntryInputSchema
>;
