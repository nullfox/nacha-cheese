"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeCheckDigit = void 0;
const computeCheckDigit = (routing) => {
    const a = routing.split('').map(Number);
    return a.length !== 8
        ? routing
        : routing + ((7 * (a[0] + a[3] + a[6]) + 3 * (a[1] + a[4] + a[7]) + 9 * (a[2] + a[5])) % 10);
};
exports.computeCheckDigit = computeCheckDigit;
