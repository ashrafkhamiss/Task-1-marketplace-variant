import Joi from 'joi';
import { Listing } from '../models/Listing.js';

const CATEGORIES = ['textbooks', 'electronics', 'furniture', 'clothing', 'other'];
const CONDITIONS = ['new', 'like-new', 'used', 'worn'];

// status is deliberately absent here: it's not a field a client sets directly
// on create, and it must not be editable through the generic PATCH either
// (see markAsSold / deleteListing, which move status through dedicated,
// narrower endpoints instead).
const createSchema = Joi.object({
  title: Joi.string().min(1).max(120).required(),
  description: Joi.string().allow('').max(2000),
  price: Joi.number().min(0).required(),
  category: Joi.string().valid(...CATEGORIES),
  condition: Joi.string().valid(...CONDITIONS),
  seller: Joi.string().hex().length(24)
});

const updateSchema = Joi.object({
  title: Joi.string().min(1).max(120),
  description: Joi.string().allow('').max(2000),
  price: Joi.number().min(0),
  category: Joi.string().valid(...CATEGORIES),
  condition: Joi.string().valid(...CONDITIONS)
});

// GET /api/listings
// Removed listings are hidden unless ?includeRemoved=true is passed
// explicitly — the README calls out that GET must not silently surface
// them, so exclusion is the default and opting in is a conscious query.
export async function getAllListings(req, res, next) {
  try {
    const filter = req.query.includeRemoved === 'true' ? {} : { status: { $ne: 'removed' } };
    const listings = await Listing.find(filter)
      .sort({ createdAt: -1 })
      .populate('seller', 'name email');
    res.json({ listings });
  } catch (err) { next(err); }
}

// GET /api/listings/:id
export async function getListing(req, res, next) {
  try {
    const listing = await Listing.findById(req.params.id).populate('seller', 'name email');
    if (!listing) return res.status(404).json({ message: 'Listing not found' });
    if (listing.status === 'removed' && req.query.includeRemoved !== 'true') {
      return res.status(404).json({ message: 'Listing not found' });
    }
    res.json({ listing });
  } catch (err) { next(err); }
}

// POST /api/listings
export async function createListing(req, res, next) {
  try {
    const { value, error } = createSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) return res.status(400).json({ message: error.message });

    const listing = await Listing.create(value);
    res.status(201).json({ listing });
  } catch (err) { next(err); }
}

// PATCH /api/listings/:id
// Generic edit for the listing's own attributes. status can't be changed
// here (it's not in updateSchema, so stripUnknown drops it) — that keeps
// this endpoint from becoming a backdoor around the sold/removed flows.
// Once a listing is sold or removed, its attributes are frozen: a sold
// listing shouldn't have its price/category rewritten after the fact, and
// a removed one has no business being edited at all.
export async function updateListing(req, res, next) {
  try {
    const { value, error } = updateSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) return res.status(400).json({ message: error.message });

    const existing = await Listing.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Listing not found' });
    if (existing.status !== 'active') {
      return res.status(409).json({ message: `Cannot edit a listing with status "${existing.status}"` });
    }

    existing.set(value);
    await existing.save();
    res.json({ listing: existing });
  } catch (err) { next(err); }
}

// DELETE /api/listings/:id
// Soft delete: flips status to 'removed' instead of dropping the document,
// so a listing tied to a past sale/dispute still exists for lookup — it
// just stops showing up in default GETs (see the includeRemoved checks above).
export async function deleteListing(req, res, next) {
  try {
    const listing = await Listing.findByIdAndUpdate(
      req.params.id,
      { $set: { status: 'removed' } },
      { new: true }
    );
    if (!listing) return res.status(404).json({ message: 'Listing not found' });
    res.json({ listing });
  } catch (err) { next(err); }
}

// PATCH /api/listings/:id/sold
// Bypasses updateSchema entirely: once a listing is sold, price/category/etc.
// shouldn't be editable, so this only ever sets one field and nothing else.
export async function markAsSold(req, res, next) {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing || listing.status === 'removed') {
      return res.status(404).json({ message: 'Listing not found' });
    }
    listing.status = 'sold';
    await listing.save();
    res.json({ listing });
  } catch (err) { next(err); }
}
