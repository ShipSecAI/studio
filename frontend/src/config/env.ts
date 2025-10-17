import { z } from 'zod'

const EnvSchema = z.object({
  VITE_BACKEND_URL: z.string().url().default('http://localhost:8080'),
})

const processEnv = {
  VITE_BACKEND_URL: import.meta.env.VITE_BACKEND_URL,
}

export const env = EnvSchema.parse(processEnv)