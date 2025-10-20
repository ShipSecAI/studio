import { z } from 'zod'

const EnvSchema = z.object({
  VITE_BACKEND_URL: z.string().url().default('http://localhost:8080'),
  VITE_FRONTEND_BRANCH: z.string().optional().default(''),
  VITE_BACKEND_BRANCH: z.string().optional().default(''),
})

const processEnv = {
  VITE_BACKEND_URL: import.meta.env.VITE_BACKEND_URL,
  VITE_FRONTEND_BRANCH: import.meta.env.VITE_FRONTEND_BRANCH,
  VITE_BACKEND_BRANCH: import.meta.env.VITE_BACKEND_BRANCH,
}

export const env = EnvSchema.parse(processEnv)
