import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface BookDocument extends Document {
  user: Types.ObjectId;
  title: string;
  basePrompt: string;
  pageCount: number;
  pagePrompts: string[];
  pdf?: Buffer; // optional for backward compatibility
  pdfPath: string; // filesystem path to the generated PDF
  createdAt: Date;
  updatedAt: Date;
}

const BookSchema = new Schema<BookDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    basePrompt: { type: String, required: true },
    pageCount: { type: Number, required: true, min: 1 },
    pagePrompts: { type: [String], required: true },
    pdf: { type: Buffer, required: false },
    pdfPath: { type: String, required: true },
  },
  { timestamps: true }
);

export const Book: Model<BookDocument> =
  (mongoose.models.Book as Model<BookDocument>) ||
  mongoose.model<BookDocument>('Book', BookSchema);
