import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IProcessedEvent extends Document {
  eventId: string;
  source: 'revenuecat';
  processedAt: Date;
}

const ProcessedEventSchema = new Schema<IProcessedEvent>({
  eventId: { type: String, required: true, unique: true, index: true },
  source: { type: String, enum: ['revenuecat'], default: 'revenuecat' },
  processedAt: { type: Date, default: () => new Date() },
});

export const ProcessedEvent: Model<IProcessedEvent> =
  mongoose.models.ProcessedEvent || mongoose.model<IProcessedEvent>('ProcessedEvent', ProcessedEventSchema);
