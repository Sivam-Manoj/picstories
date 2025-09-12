import dotenv from 'dotenv';

dotenv.config();

export const config = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT || 3000),
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  MONGODB_URL: process.env.MONGODB_URL || '',
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-5-mini',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash-image-preview',
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || 'dev_access_secret',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret',
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  EMAIL_FROM: process.env.EMAIL_FROM || 'PicStory <no-reply@sellsnap.co.uk>',
} as const;

export function assertRequiredEnv() {
  const missing: string[] = [];
  if (!config.MONGODB_URL) missing.push('MONGODB_URL');
  if (!config.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
  if (!config.GEMINI_API_KEY) missing.push('GEMINI_API_KEY');
  if (!config.JWT_ACCESS_SECRET) missing.push('JWT_ACCESS_SECRET');
  if (!config.JWT_REFRESH_SECRET) missing.push('JWT_REFRESH_SECRET');
  if (!config.RESEND_API_KEY) console.warn('RESEND_API_KEY not set: email verification will be disabled');
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
