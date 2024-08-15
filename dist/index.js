"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const date_fns_1 = require("date-fns");
const fs_1 = require("fs");
const zod_1 = require("zod");
// ///////////////////////////////////////
// CONSTANTS
// ///////////////////////////////////////
var ServiceClass;
(function (ServiceClass) {
    ServiceClass["CreidtDebit"] = "200";
    ServiceClass["Credit"] = "220";
    ServiceClass["Debit"] = "225";
})(ServiceClass || (ServiceClass = {}));
var TransactionCode;
(function (TransactionCode) {
    TransactionCode["CheckingCredit"] = "22";
    TransactionCode["CheckingDebit"] = "27";
    TransactionCode["SavingsCredit"] = "32";
    TransactionCode["SavingsDebit"] = "37";
})(TransactionCode || (TransactionCode = {}));
var BatchCode;
(function (BatchCode) {
    BatchCode["ARC"] = "ARC";
    BatchCode["BOC"] = "BOC";
    BatchCode["CCD"] = "CCD";
    BatchCode["CIE"] = "CIE";
    BatchCode["CTX"] = "CTX";
    BatchCode["IAT"] = "IAT";
    BatchCode["POP"] = "POP";
    BatchCode["POS"] = "POS";
    BatchCode["PPD"] = "PPD";
    BatchCode["RCK"] = "RCK";
    BatchCode["TEL"] = "TEL";
    BatchCode["WEB"] = "WEB";
})(BatchCode || (BatchCode = {}));
const DEBIT_TYPES = [TransactionCode.CheckingDebit, TransactionCode.SavingsDebit];
const CREDIT_TYPES = [TransactionCode.CheckingCredit, TransactionCode.SavingsCredit];
const LINE_LENGTH = 94;
// ///////////////////////////////////////
// HELPERS
// ///////////////////////////////////////
const amountToCents = (amount) => amount.toFixed(2).replace('.', '');
const blankLine = '9'.repeat(LINE_LENGTH);
// ///////////////////////////////////////
// NACHA BATCH
// ///////////////////////////////////////
const DEFAULTS_BATCH_HEADER = {
    originStatusCode: '1',
};
const batchHeaderInputSchema = zod_1.z.object({
    transactionTypes: zod_1.z.nativeEnum(ServiceClass),
    originCompanyName: zod_1.z.string().max(16),
    originDiscretionaryData: zod_1.z.string().max(20).optional(),
    originIdentification: zod_1.z.string().max(10),
    code: zod_1.z.nativeEnum(BatchCode),
    description: zod_1.z.string().max(10),
    descriptiveDate: zod_1.z.date().optional().default(new Date()),
    effectiveEntryDate: zod_1.z.date().optional().default(new Date()),
    originDfi: zod_1.z.string().length(8),
    messageAuthenticationCode: zod_1.z.string().length(19).optional(),
});
class Batch {
    fields;
    entries = [];
    constructor(input) {
        const parsed = batchHeaderInputSchema.parse(input);
        this.fields = {
            ...DEFAULTS_BATCH_HEADER,
            ...parsed,
        };
    }
    addEntry(entry) {
        this.entries.push(entry);
    }
    getEntryCount() {
        return this.entries.length;
    }
    // TODO: Implement
    getEntriesAddendaCount() {
        return this.entries.reduce((acc, entry) => (entry.hasAddenda() ? acc + 1 : acc), 0);
    }
    getEntriesHash() {
        return this.entries.reduce((acc, entry) => acc + entry.getDfiIdentifier(), 0);
    }
    getEntriesDebitAmount() {
        return this.entries.reduce((acc, entry) => acc + entry.getDebitAmount(), 0);
    }
    getEntriesCreditAmount() {
        return this.entries.reduce((acc, entry) => acc + entry.getCreditAmount(), 0);
    }
    getHeader(number) {
        return [
            5,
            this.fields.transactionTypes,
            this.fields.originCompanyName.padEnd(16, ' '),
            (this.fields.originDiscretionaryData || '').padEnd(20, ' '),
            this.fields.originIdentification.padEnd(10, ' '),
            this.fields.code,
            this.fields.description.toUpperCase().padEnd(10, ' '),
            (0, date_fns_1.format)(this.fields.descriptiveDate, 'yyMMdd'),
            (0, date_fns_1.format)(this.fields.effectiveEntryDate, 'yyMMdd'),
            ' '.repeat(3),
            this.fields.originStatusCode,
            this.fields.originDfi,
            number.toString().padStart(7, '0'),
        ].join('');
    }
    getEntries() {
        return this.entries
            .map((entry, idx) => entry.toOutput(this.fields.code, this.fields.originDfi, idx + 1))
            .flat();
    }
    getTrailer(number) {
        const entryAddendaCount = this.getEntryCount() + this.getEntriesAddendaCount();
        const entryHash = this.getEntriesHash();
        const debitAmount = this.entries.reduce((acc, entry) => acc + entry.getDebitAmount(), 0);
        const creditAmount = this.entries.reduce((acc, entry) => acc + entry.getCreditAmount(), 0);
        return [
            8,
            this.fields.transactionTypes,
            entryAddendaCount.toString().padStart(6, '0'),
            entryHash.toString().padStart(10, '0'),
            amountToCents(debitAmount).padStart(12, '0'),
            amountToCents(creditAmount).padStart(12, '0'),
            this.fields.originIdentification.padEnd(10, ' '),
            (this.fields.messageAuthenticationCode || '').padEnd(19, ' '),
            ' '.repeat(6),
            this.fields.originDfi,
            number.toString().padStart(7, '0'),
        ].join('');
    }
    toOutput(number) {
        return [
            // Batch header
            this.getHeader(number),
            // Batch entries
            ...this.getEntries(),
            // Batch trailer
            this.getTrailer(number),
        ];
    }
}
// ///////////////////////////////////////
// NACHA ENTRY
// ///////////////////////////////////////
const DEFAULTS_ENTRY = {
    recordTypeCode: '6',
};
const entryInputSchema = zod_1.z.object({
    transactionCode: zod_1.z.nativeEnum(TransactionCode),
    destinationRoutingNumber: zod_1.z.string().length(9),
    destinationAccountNumber: zod_1.z.string().max(17),
    amount: zod_1.z.number(),
    transactionId: zod_1.z.string().regex(/^\d+$/).max(15).optional(),
    destinationName: zod_1.z.string().max(22),
    discretionaryData: zod_1.z.string().max(2).optional().default(''),
    addendaId: zod_1.z.string().length(1).optional(),
});
class Entry {
    fields;
    addenda;
    constructor(input) {
        const parsed = entryInputSchema.parse(input);
        this.fields = {
            ...DEFAULTS_ENTRY,
            ...parsed,
        };
    }
    hasAddenda() {
        return !!this.addenda;
    }
    setAddenda(addenda) {
        this.addenda = addenda;
    }
    getDfiIdentifier() {
        return parseInt(this.fields.destinationRoutingNumber.slice(0, 8), 10);
    }
    getCreditAmount() {
        return CREDIT_TYPES.includes(this.fields.transactionCode) ? this.getAmount() : 0;
    }
    getDebitAmount() {
        return DEBIT_TYPES.includes(this.fields.transactionCode) ? this.getAmount() : 0;
    }
    getAmount() {
        return parseFloat(this.fields.amount.toFixed(2));
    }
    getEntry(batchCode, originDfi, number) {
        return [
            this.fields.recordTypeCode,
            this.fields.transactionCode,
            this.fields.destinationRoutingNumber,
            this.fields.destinationAccountNumber.padEnd(17, ' '),
            amountToCents(this.getAmount()).padStart(10, '0'),
            (this.fields.transactionId || '').padEnd(15, ' '),
            this.fields.destinationName.padEnd(22, ' '),
            (this.fields.discretionaryData || '').padEnd(2, ' '),
            this.addenda ? '1' : '0',
            originDfi,
            number.toString().padStart(7, '0'),
        ].join('');
    }
    getAddenda(number) {
        if (!this.addenda) {
            return undefined;
        }
        return this.addenda.toOutput(number.toString().padStart(7, '0'));
    }
    toOutput(batchCode, originDfi, number) {
        const lines = [this.getEntry(batchCode, originDfi, number)];
        const addenda = this.getAddenda(number);
        if (addenda) {
            lines.push(addenda);
        }
        return lines;
    }
}
// ///////////////////////////////////////
// NACHA ENTRY ADDENDA
// ///////////////////////////////////////
const DEFAULTS_ENTRY_ADDENDA = {
    recordTypeCode: '7',
    addendaTypeCode: '05',
    sequenceNumber: '1',
};
const entryAddendaInputSchema = zod_1.z.object({
    info: zod_1.z.string().max(80).optional(),
});
class EntryAddenda {
    fields;
    constructor(input) {
        const parsed = entryAddendaInputSchema.parse(input);
        this.fields = {
            ...DEFAULTS_ENTRY_ADDENDA,
            ...parsed,
        };
    }
    toOutput(trace) {
        return [
            this.fields.recordTypeCode,
            this.fields.addendaTypeCode,
            (this.fields.info || '').padEnd(80, ' '),
            this.fields.sequenceNumber.padStart(4, '0'),
            trace.padEnd(7, ' '),
        ].join('');
    }
}
// ///////////////////////////////////////
// NACHA
// ///////////////////////////////////////
const DEFAULTS_NACHA = {
    recordTypeCode: '1',
    priorityCode: '01',
    recordSize: `0${LINE_LENGTH}`,
    blockingFactor: '10',
    formatCode: '1',
};
const nachaInputSchema = zod_1.z.object({
    originRoutingNumber: zod_1.z.string().length(9),
    originName: zod_1.z.string().max(23).optional(),
    destinationRoutingNumber: zod_1.z.string().length(9),
    destinationName: zod_1.z.string().max(23).optional(),
    fileCreationDate: zod_1.z.date().optional().default(new Date()),
    fileIdModifier: zod_1.z
        .string()
        .regex(/^[A-Z0-9]{1}$/, 'Value must be single character A-Z or 0-9')
        .optional()
        .default('A'),
    referenceCode: zod_1.z.string().max(8).optional(),
});
class Nacha {
    fields;
    batches = [];
    constructor(input) {
        const parsed = nachaInputSchema.parse(input);
        this.fields = {
            ...DEFAULTS_NACHA,
            ...parsed,
        };
    }
    addBatch(batch) {
        this.batches.push(batch);
    }
    getHeader() {
        return [
            this.fields.recordTypeCode,
            this.fields.priorityCode,
            this.fields.destinationRoutingNumber.padStart(10, ' '),
            this.fields.originRoutingNumber.padStart(10, ' '),
            (0, date_fns_1.format)(this.fields.fileCreationDate, 'yyMMdd'),
            (0, date_fns_1.format)(this.fields.fileCreationDate, 'HHmm'),
            this.fields.fileIdModifier,
            this.fields.recordSize,
            this.fields.blockingFactor,
            this.fields.formatCode,
            this.fields.destinationName?.padEnd(23, ' '),
            this.fields.originName?.padEnd(23, ' '),
            this.fields.referenceCode?.padEnd(8, ' '),
        ].join('');
    }
    getTrailer(totalLines) {
        const blockCount = Math.ceil(totalLines / 10);
        console.log('LInes', totalLines, totalLines / 10);
        const entryAddendaCount = this.batches.reduce((acc, batch) => acc + batch.getEntryCount() + batch.getEntriesAddendaCount(), 0);
        const entriesHash = this.batches.reduce((acc, batch) => acc + batch.getEntriesHash(), 0);
        const debitAmount = this.batches.reduce((acc, batch) => acc + batch.getEntriesDebitAmount(), 0);
        const creditAmount = this.batches.reduce((acc, batch) => acc + batch.getEntriesCreditAmount(), 0);
        return [
            9,
            this.batches.length.toString().padStart(6, '0'),
            blockCount.toString().padStart(6, '0'),
            entryAddendaCount.toString().padStart(8, '0'),
            entriesHash.toString().padStart(10, '0'),
            amountToCents(debitAmount).padStart(12, '0'),
            amountToCents(creditAmount).padStart(12, '0'),
            ' '.repeat(39),
        ].join('');
    }
    toOutput() {
        const lines = [
            // File header
            this.getHeader(),
            // Each batch with its entries
            ...this.batches.map((batch, idx) => batch.toOutput(idx + 1)).flat(),
        ];
        lines.push(
        // File trailer
        this.getTrailer(lines.length + 1));
        const leftOverLines = lines.length % 10;
        return [...lines, ...Array(leftOverLines > 0 ? 10 - leftOverLines : 0).fill(blankLine)].join('\n');
    }
}
// ///////////////////////////////////////
// TEST IMPLEMENTATION
// ///////////////////////////////////////
const nacha = new Nacha({
    originRoutingNumber: '011401533',
    originName: 'Some Bank',
    destinationRoutingNumber: '091000019',
    destinationName: 'Your Bank',
    fileCreationDate: new Date('2023-01-01T00:00:00.000Z'),
    fileIdModifier: 'A',
    referenceCode: '12',
});
const batchOne = new Batch({
    transactionTypes: ServiceClass.Credit,
    originCompanyName: 'Your Company Inc',
    originDiscretionaryData: 'A1',
    originIdentification: 'RAj2392',
    code: BatchCode.CCD,
    description: 'Payroll',
    descriptiveDate: new Date('2023-01-01T00:00:00.000Z'),
    effectiveEntryDate: new Date('2023-01-01T00:00:00.000Z'),
    originDfi: '01140153',
});
batchOne.addEntry(new Entry({
    transactionCode: TransactionCode.CheckingCredit,
    destinationRoutingNumber: '091000019',
    destinationAccountNumber: '1234567897',
    amount: 3521,
    transactionId: '000001309',
    destinationName: 'Leroy Jenkins',
}));
const entry = new Entry({
    transactionCode: TransactionCode.CheckingCredit,
    destinationRoutingNumber: '091000019',
    destinationAccountNumber: '1234567897',
    amount: 50.5,
    transactionId: '000001313',
    destinationName: 'Leroy Jenkins',
});
entry.setAddenda(new EntryAddenda({
    info: 'Im a special boy',
}));
batchOne.addEntry(entry);
nacha.addBatch(batchOne);
const batchTwo = new Batch({
    transactionTypes: ServiceClass.Debit,
    originCompanyName: 'Your Company Inc',
    originDiscretionaryData: 'A1',
    originIdentification: 'Foobar',
    code: BatchCode.CCD,
    description: 'You Know',
    descriptiveDate: new Date('2024-04-01T00:00:00.000Z'),
    effectiveEntryDate: new Date('2024-04-01T00:00:00.000Z'),
    originDfi: '01140153',
});
batchTwo.addEntry(new Entry({
    transactionCode: TransactionCode.CheckingDebit,
    destinationRoutingNumber: '091000019',
    destinationAccountNumber: '1234567897',
    amount: 3.5,
    transactionId: '5051309',
    destinationName: 'Richard Branson',
}));
nacha.addBatch(batchTwo);
(0, fs_1.writeFileSync)('test.txt', nacha.toOutput());
