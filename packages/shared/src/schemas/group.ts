import { z } from 'zod';

export const createGroupSchema = z.object({
  name: z.string().min(1),
});

export const addMemberSchema = z.object({
  email: z.string().email(),
});

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;
