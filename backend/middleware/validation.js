/**
 * Validation Middleware
 * Input validation using express-validator
 */

const { body, param, query, validationResult } = require('express-validator');

/**
 * Handle validation errors
 */
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation failed',
            details: errors.array().map(err => ({
                field: err.path,
                message: err.msg
            }))
        });
    }
    next();
};

/**
 * Registration validation
 */
const registerValidation = [
    body('fullName')
        .trim()
        .notEmpty().withMessage('Full name is required')
        .isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
    body('email')
        .trim()
        .notEmpty().withMessage('Email is required')
        .isEmail().withMessage('Invalid email format')
        .normalizeEmail(),
    body('phone')
        .trim()
        .notEmpty().withMessage('Phone number is required')
        .matches(/^0[2-59]\d{8}$/).withMessage('Invalid phone number (must be 10 digits starting with 0)'),
    body('password')
        .notEmpty().withMessage('Password is required')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
        .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
        .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter')
        .matches(/[0-9]/).withMessage('Password must contain at least one number')
        .matches(/[!@#$%^&*(),.?":{}|<>]/).withMessage('Password must contain at least one special character (!@#$%^&*(),.?":{}|<>)'),
    handleValidationErrors
];

/**
 * Login validation
 */
const loginValidation = [
    body('emailOrPhone')
        .trim()
        .notEmpty().withMessage('Email or phone is required'),
    body('password')
        .notEmpty().withMessage('Password is required'),
    handleValidationErrors
];

/**
 * Admin login validation (accepts username or emailOrPhone)
 */
const adminLoginValidation = [
    body('password')
        .notEmpty().withMessage('Password is required'),
    handleValidationErrors
];

/**
 * Order validation
 */
const orderValidation = [
    body('items')
        .isArray({ min: 1 }).withMessage('At least one item is required'),
    body('items.*.packageId')
        .notEmpty().withMessage('Package ID is required'),
    body('items.*.phoneNumber')
        .matches(/^0[2-59]\d{8}$/).withMessage('Invalid phone number (must be 10 digits starting with 0)'),
    body('network')
        .isIn(['MTN', 'AirtelTigo', 'Telecel']).withMessage('Invalid network'),
    handleValidationErrors
];

/**
 * Wallet topup validation
 * Uses DB-configured minimum deposit instead of hardcoded value
 */
const topupValidation = [
    body('amount')
        .isFloat({ min: 5 }).withMessage('Minimum topup amount is GH₵5.00')
        .custom(async (value) => {
            const { Setting } = require('../models');
            const limits = await Setting.getDepositLimits();
            if (parseFloat(value) < limits.minDeposit) {
                throw new Error(`Minimum topup amount is GH₵${limits.minDeposit.toFixed(2)}`);
            }
            return true;
        }),
    handleValidationErrors
];

/**
 * Phone number validation
 */
const phoneValidation = [
    body('phone')
        .matches(/^0[2-59]\d{8}$/).withMessage('Invalid phone number (must be 10 digits starting with 0)'),
    handleValidationErrors
];

/**
 * ID param validation (UUID format)
 */
const idParamValidation = [
    param('id')
        .isUUID(4).withMessage('Invalid ID format'),
    handleValidationErrors
];

/**
 * Order ID validation (format: BTU-XXXXXXX-XXXX)
 */
const orderIdValidation = [
    param('orderId')
        .matches(/^BTU-[A-Z0-9]+-[A-Z0-9]+$/).withMessage('Invalid order ID format'),
    handleValidationErrors
];

module.exports = {
    handleValidationErrors,
    registerValidation,
    loginValidation,
    adminLoginValidation,
    orderValidation,
    topupValidation,
    phoneValidation,
    idParamValidation,
    orderIdValidation
};
