import z from "zod";

const email = z.email({ error: "Please enter a valid email." }).trim();

const password = z
  .string()
  .regex(/^(?=.*[0-9])(?=.*[!@#$%^&*()_\-+=<>?/\\|{}[\].,:;]).*$/, { error: "Password must contain at least one number and one special character" })
  .min(8, { error: "Password must be at least 8 characters long" })
  .trim();

export const LoginSchema = z.object({ email, password });

export const RegisterSchema = z.object({
  name: z
    .string()
    .min(1, { error: "Name must be at least 1 character long" })
    .refine((val) => val.trim().length > 0, {
      error: "Name cannot only contain spaces",
    }),
  address: z.string().trim().optional(),
  email,
  password,
});

export const ForgotPasswordSchema = z.object({
  email,
});

export const ResetPasswordSchema = z.object({
  token: z.string(),
  password,
});

export type LoginSchemaType = z.infer<typeof LoginSchema>;
export type RegisterSchemaType = z.infer<typeof RegisterSchema>;
export type ForgotPasswordSchemaType = z.infer<typeof ForgotPasswordSchema>;
export type ResetPasswordSchemaType = z.infer<typeof ResetPasswordSchema>;
export type VerificationEmailSchemaType = { token: string };
export type ResetPasswordTokenSchemaType = { token: string };
