import { z } from "zod";

const InstagramAccountSchema = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    pageAccessToken: z.string().optional(),
    tokenFile: z.string().optional(),
    pageId: z.string().optional(),
    webhookVerifyToken: z.string().optional(),
    appSecret: z.string().optional(),
    webhookPath: z.string().optional(),
    apiVersion: z.string().optional(),
    dmPolicy: z.enum(["allowlist", "open", "disabled"]).optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  })
  .strict();

export const InstagramConfigSchema = InstagramAccountSchema.extend({
  accounts: z.record(z.string(), InstagramAccountSchema).optional(),
  defaultAccount: z.string().optional(),
}).strict();
