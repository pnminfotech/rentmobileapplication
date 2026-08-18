const mongoose = require('mongoose');

const duplicateFormSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    default: null,
    index: true,
  },
  originalFormId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Form', 
    required: true 
  },
  formData: { 
    type: Object, 
    required: true // Store all form data here
  },
  deletedAt: { 
    type: Date, 
    default: Date.now // Timestamp for when the form was deleted
  },
});

duplicateFormSchema.index({ organizationId: 1, deletedAt: -1 });

module.exports = mongoose.model('DuplicateForm', duplicateFormSchema);
