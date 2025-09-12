import mongoose, { Schema, Document, Model } from 'mongoose';

export interface OAuthProvider {
  provider: 'google' | 'apple';
  providerId: string;
}

export interface IUser extends Document {
  email: string;
  name?: string;
  passwordHash?: string;
  verified: boolean;
  verificationCode?: string;
  verificationCodeExpires?: Date;
  verificationLastSentAt?: Date;
  refreshTokenHash?: string; // single active refresh token for simplicity
  credits: number;
  providers?: OAuthProvider[];
  createdAt: Date;
  updatedAt: Date;
}

const OAuthProviderSchema = new Schema<OAuthProvider>({
  provider: { type: String, enum: ['google', 'apple'], required: true },
  providerId: { type: String, required: true },
}, { _id: false });

const UserSchema = new Schema<IUser>({
  email: { type: String, required: true, unique: true, index: true },
  name: { type: String },
  passwordHash: { type: String },
  verified: { type: Boolean, default: false },
  verificationCode: { type: String },
  verificationCodeExpires: { type: Date },
  verificationLastSentAt: { type: Date },
  refreshTokenHash: { type: String },
  credits: { type: Number, default: 10 },
  providers: { type: [OAuthProviderSchema], default: [] },
}, { timestamps: true });

export const User: Model<IUser> = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
