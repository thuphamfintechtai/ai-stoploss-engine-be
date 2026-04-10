export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Joi validation error
  if (err.isJoi && Array.isArray(err.details)) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: err.details.map(d => ({
        field: (d.path || []).join('.'),
        message: d.message || 'Invalid value'
      }))
    });
  }

  // Database error
  if (err.code) {
    // PostgreSQL unique violation
    if (err.code === '23505') {
      console.error('Unique violation:', err.detail);
      return res.status(409).json({
        success: false,
        message: 'Record already exists'
      });
    }

    // PostgreSQL foreign key violation
    if (err.code === '23503') {
      console.error('Foreign key violation:', err.detail);
      return res.status(400).json({
        success: false,
        message: 'Invalid reference'
      });
    }
  }

  // Default error
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

export const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
};

export default { errorHandler, notFound };
