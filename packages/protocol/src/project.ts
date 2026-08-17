import { z } from "zod";

const MAX_PROJECT_NAME_LENGTH = 160;
const MAX_PROJECT_ENTRY_NAME_LENGTH = 255;
const MAX_PROJECT_PATH_LENGTH = 32_767;
const MAX_PROJECT_FILE_CONTENT_LENGTH = 2_100_000;

function isSafeRelativeProjectPath(value: string): boolean {
  if (value.length === 0) {
    return true;
  }

  return (
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\u0000") &&
    value.split("/").every(
      (segment) => segment.length > 0 && segment !== "." && segment !== ".."
    )
  );
}

export const projectIdSchema = z.string().uuid();

export const relativeProjectPathSchema = z
  .string()
  .max(MAX_PROJECT_PATH_LENGTH)
  .refine(isSafeRelativeProjectPath, {
    message: "Project paths must be relative POSIX paths inside the project root."
  });

export const projectSummarySchema = z
  .object({
    id: projectIdSchema,
    isPinned: z.boolean().optional(),
    name: z.string().trim().min(1).max(MAX_PROJECT_NAME_LENGTH),
    rootPath: z.string().trim().min(1).max(MAX_PROJECT_PATH_LENGTH)
  })
  .strict();

export const projectReferenceInputSchema = z
  .object({ projectId: projectIdSchema })
  .strict();

export const renameProjectInputSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_PROJECT_NAME_LENGTH),
    projectId: projectIdSchema
  })
  .strict();

export const setProjectPinnedInputSchema = z
  .object({
    pinned: z.boolean(),
    projectId: projectIdSchema
  })
  .strict();

export const reorderProjectsInputSchema = z
  .object({
    projectIds: z.array(projectIdSchema).min(1).max(1_000)
  })
  .strict();

export const projectEntryKindSchema = z.enum(["directory", "file", "symlink"]);
export const javaDeclarationKindSchema = z.enum([
  "annotation",
  "class",
  "enum",
  "interface",
  "record"
]);

export const projectEntrySchema = z
  .object({
    javaDeclarationKind: javaDeclarationKindSchema.optional(),
    kind: projectEntryKindSchema,
    modifiedAt: z.string().datetime().optional(),
    name: z.string().trim().min(1).max(MAX_PROJECT_ENTRY_NAME_LENGTH),
    path: relativeProjectPathSchema
  })
  .strict();

export const listProjectEntriesInputSchema = z
  .object({
    directoryPath: relativeProjectPathSchema,
    projectId: projectIdSchema
  })
  .strict();

export const projectDirectoryListingSchema = z
  .object({
    directoryPath: relativeProjectPathSchema,
    entries: z.array(projectEntrySchema),
    projectId: projectIdSchema,
    truncated: z.boolean()
  })
  .strict();

export const readProjectFileInputSchema = z
  .object({
    path: relativeProjectPathSchema.refine((value) => value.length > 0, {
      message: "A file path is required."
    }),
    projectId: projectIdSchema
  })
  .strict();

export const createProjectEntryInputSchema = z
  .object({
    kind: z.enum(["directory", "file"]),
    path: relativeProjectPathSchema
      .refine((value) => value.length > 0, {
        message: "A project entry path is required."
      })
      .refine((value) => (value.split("/").at(-1)?.length ?? 0) <= MAX_PROJECT_ENTRY_NAME_LENGTH, {
        message: "The project entry name is too long."
      }),
    projectId: projectIdSchema
  })
  .strict();

export const projectFileSchema = z
  .object({
    byteLength: z.number().int().nonnegative(),
    content: z.string().max(MAX_PROJECT_FILE_CONTENT_LENGTH).nullable(),
    isBinary: z.boolean(),
    name: z.string().trim().min(1).max(MAX_PROJECT_ENTRY_NAME_LENGTH),
    path: relativeProjectPathSchema,
    projectId: projectIdSchema,
    truncated: z.boolean()
  })
  .strict();

export const projectListResponseSchema = z.array(projectSummarySchema);
export const addProjectResponseSchema = projectSummarySchema.nullable();

export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type ProjectReferenceInput = z.infer<typeof projectReferenceInputSchema>;
export type RenameProjectInput = z.infer<typeof renameProjectInputSchema>;
export type SetProjectPinnedInput = z.infer<typeof setProjectPinnedInputSchema>;
export type ReorderProjectsInput = z.infer<typeof reorderProjectsInputSchema>;
export type ProjectEntry = z.infer<typeof projectEntrySchema>;
export type ProjectEntryKind = z.infer<typeof projectEntryKindSchema>;
export type JavaDeclarationKind = z.infer<typeof javaDeclarationKindSchema>;
export type ListProjectEntriesInput = z.infer<typeof listProjectEntriesInputSchema>;
export type ProjectDirectoryListing = z.infer<typeof projectDirectoryListingSchema>;
export type ReadProjectFileInput = z.infer<typeof readProjectFileInputSchema>;
export type CreateProjectEntryInput = z.infer<typeof createProjectEntryInputSchema>;
export type ProjectFile = z.infer<typeof projectFileSchema>;
