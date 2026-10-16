// Pure JavaScript QR Code Generator (Zero external dependencies)
// Supports alphanumeric, numeric, and byte/UTF-8 encoding with L, M, Q, H error correction.

// QR Code specification tables and polynomial constants
const QRMode = {
    MODE_NUMBER: 1 << 0,
    MODE_ALPHA_NUM: 1 << 1,
    MODE_8BIT_BYTE: 1 << 2,
};

const QRErrorCorrectionLevel = {
    L: 1,
    M: 0,
    Q: 3,
    H: 2,
};

const QRMaskPattern = {
    PATTERN000: 0,
    PATTERN001: 1,
    PATTERN010: 2,
    PATTERN011: 3,
    PATTERN100: 4,
    PATTERN101: 5,
    PATTERN110: 6,
    PATTERN111: 7,
};

// Galois field tables
const QRMath = {
    glog(n) {
        if (n < 1) throw new Error('glog(' + n + ')');
        return QRMath.LOG_TABLE[n];
    },
    gexp(n) {
        while (n < 0) n += 255;
        while (n >= 256) n -= 255;
        return QRMath.EXP_TABLE[n];
    },
    EXP_TABLE: new Array(256),
    LOG_TABLE: new Array(256),
};

for (let i = 0; i < 8; i++) QRMath.EXP_TABLE[i] = 1 << i;
for (let i = 8; i < 256; i++) {
    QRMath.EXP_TABLE[i] =
        QRMath.EXP_TABLE[i - 4] ^
        QRMath.EXP_TABLE[i - 5] ^
        QRMath.EXP_TABLE[i - 6] ^
        QRMath.EXP_TABLE[i - 8];
}
for (let i = 0; i < 255; i++) QRMath.LOG_TABLE[QRMath.EXP_TABLE[i]] = i;

function QRPolynomial(num, shift) {
    if (num.length === undefined) throw new Error(num.length + '/' + shift);
    let offset = 0;
    while (offset < num.length && num[offset] === 0) offset++;
    this.num = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i++) this.num[i] = num[i + offset];
    for (let i = num.length - offset; i < this.num.length; i++) this.num[i] = 0;
}

QRPolynomial.prototype = {
    get(index) {
        return this.num[index];
    },
    getLength() {
        return this.num.length;
    },
    multiply(e) {
        const num = new Array(this.getLength() + e.getLength() - 1).fill(0);
        for (let i = 0; i < this.getLength(); i++) {
            for (let j = 0; j < e.getLength(); j++) {
                num[i + j] ^= QRMath.gexp(QRMath.glog(this.get(i)) + QRMath.glog(e.get(j)));
            }
        }
        return new QRPolynomial(num, 0);
    },
    mod(e) {
        if (this.getLength() - e.getLength() < 0) return this;
        const ratio = QRMath.glog(this.get(0)) - QRMath.glog(e.get(0));
        const num = new Array(this.getLength());
        for (let i = 0; i < this.getLength(); i++) num[i] = this.get(i);
        for (let i = 0; i < e.getLength(); i++) {
            num[i] ^= QRMath.gexp(QRMath.glog(e.get(i)) + ratio);
        }
        return new QRPolynomial(num, 0).mod(e);
    },
};

const QRRSBlock = {
    RS_BLOCK_TABLE: [
        // 1
        [1, 26, 19], [1, 26, 16], [1, 26, 13], [1, 26, 9],
        // 2
        [1, 44, 34], [1, 44, 28], [1, 44, 22], [1, 44, 16],
        // 3
        [1, 70, 55], [1, 70, 44], [2, 35, 17], [2, 35, 13],
        // 4
        [1, 100, 80], [2, 50, 32], [2, 50, 24], [4, 25, 9],
        // 5
        [1, 134, 108], [2, 67, 43], [2, 33, 15, 2, 34, 16], [2, 33, 11, 2, 34, 12],
        // 6
        [2, 86, 68], [4, 43, 27], [4, 43, 19], [4, 43, 15],
        // 7
        [2, 98, 78], [4, 49, 31], [2, 32, 14, 4, 33, 15], [4, 39, 13, 1, 40, 14],
        // 8
        [2, 121, 97], [2, 60, 38, 2, 61, 39], [4, 40, 18, 2, 41, 19], [4, 40, 14, 2, 41, 15],
        // 9
        [2, 146, 116], [3, 58, 36, 2, 59, 37], [4, 36, 16, 4, 37, 17], [4, 36, 12, 4, 37, 13],
        // 10
        [2, 86, 68, 2, 87, 69], [4, 69, 43, 1, 70, 44], [6, 43, 19, 2, 44, 20], [6, 43, 15, 2, 44, 16]
    ],
    getRSBlocks(typeNumber, errorCorrectionLevel) {
        const rsBlock = QRRSBlock.getRsBlockTable(typeNumber, errorCorrectionLevel);
        if (rsBlock === undefined) {
            throw new Error('bad rs block @ typeNumber:' + typeNumber + '/errorCorrectionLevel:' + errorCorrectionLevel);
        }
        const length = rsBlock.length / 3;
        const list = [];
        for (let i = 0; i < length; i++) {
            const count = rsBlock[i * 3 + 0];
            const totalCount = rsBlock[i * 3 + 1];
            const dataCount = rsBlock[i * 3 + 2];
            for (let j = 0; j < count; j++) {
                list.push({ totalCount, dataCount });
            }
        }
        return list;
    },
    getRsBlockTable(typeNumber, errorCorrectionLevel) {
        switch (errorCorrectionLevel) {
            case QRErrorCorrectionLevel.L:
                return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
            case QRErrorCorrectionLevel.M:
                return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
            case QRErrorCorrectionLevel.Q:
                return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
            case QRErrorCorrectionLevel.H:
                return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
            default:
                return undefined;
        }
    },
};

function QRBitBuffer() {
    this.buffer = [];
    this.length = 0;
}

QRBitBuffer.prototype = {
    get(index) {
        const bufIndex = Math.floor(index / 8);
        return ((this.buffer[bufIndex] >>> (7 - (index % 8))) & 1) === 1;
    },
    put(num, length) {
        for (let i = 0; i < length; i++) {
            this.putBit(((num >>> (length - i - 1)) & 1) === 1);
        }
    },
    putBit(bit) {
        const bufIndex = Math.floor(this.length / 8);
        if (this.buffer.length <= bufIndex) this.buffer.push(0);
        if (bit) this.buffer[bufIndex] |= 0x80 >>> (this.length % 8);
        this.length++;
    },
};

function QR8BitByte(data) {
    this.mode = QRMode.MODE_8BIT_BYTE;
    this.data = data;
    this.parsedData = [];
    // Convert utf8 string to bytes
    for (let i = 0; i < this.data.length; i++) {
        const byteArray = [];
        const code = this.data.charCodeAt(i);
        if (code > 0x10000) {
            byteArray[0] = 0xf0 | ((code & 0x1c0000) >>> 18);
            byteArray[1] = 0x80 | ((code & 0x3f000) >>> 12);
            byteArray[2] = 0x80 | ((code & 0xfc0) >>> 6);
            byteArray[3] = 0x80 | (code & 0x3f);
        } else if (code > 0x800) {
            byteArray[0] = 0xe0 | ((code & 0xf000) >>> 12);
            byteArray[1] = 0x80 | ((code & 0xfc0) >>> 6);
            byteArray[2] = 0x80 | (code & 0x3f);
        } else if (code > 0x80) {
            byteArray[0] = 0xc0 | ((code & 0x7c0) >>> 6);
            byteArray[1] = 0x80 | (code & 0x3f);
        } else {
            byteArray[0] = code;
        }
        this.parsedData.push(...byteArray);
    }
}

QR8BitByte.prototype = {
    getLength() {
        return this.parsedData.length;
    },
    write(buffer) {
        for (let i = 0; i < this.parsedData.length; i++) {
            buffer.put(this.parsedData[i], 8);
        }
    },
};

function QRCodeModel(typeNumber, errorCorrectionLevel) {
    this.typeNumber = typeNumber;
    this.errorCorrectionLevel = errorCorrectionLevel;
    this.modules = null;
    this.moduleCount = 0;
    this.dataCache = null;
    this.dataList = [];
}

QRCodeModel.prototype = {
    addData(data) {
        const newData = new QR8BitByte(data);
        this.dataList.push(newData);
        this.dataCache = null;
    },
    isDark(row, col) {
        if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col) {
            throw new Error(row + ',' + col);
        }
        return this.modules[row][col];
    },
    getModuleCount() {
        return this.moduleCount;
    },
    make() {
        if (this.typeNumber < 1) {
            let typeNumber = 1;
            for (; typeNumber < 10; typeNumber++) {
                const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, this.errorCorrectionLevel);
                const buffer = new QRBitBuffer();
                let totalDataCount = 0;
                for (let i = 0; i < rsBlocks.length; i++) totalDataCount += rsBlocks[i].dataCount;
                for (let i = 0; i < this.dataList.length; i++) {
                    const data = this.dataList[i];
                    buffer.put(data.mode, 4);
                    buffer.put(data.getLength(), typeNumber < 10 ? 8 : 16);
                    data.write(buffer);
                }
                if (buffer.length <= totalDataCount * 8) break;
            }
            this.typeNumber = typeNumber;
        }
        this.makeImpl(false, this.getBestMaskPattern());
    },
    makeImpl(test, maskPattern) {
        this.moduleCount = this.typeNumber * 4 + 17;
        this.modules = new Array(this.moduleCount);
        for (let row = 0; row < this.moduleCount; row++) {
            this.modules[row] = new Array(this.moduleCount).fill(null);
        }
        this.setupPositionProbePattern(0, 0);
        this.setupPositionProbePattern(this.moduleCount - 7, 0);
        this.setupPositionProbePattern(0, this.moduleCount - 7);
        this.setupPositionAdjustPattern();
        this.setupTimingPattern();
        this.setupTypeInfo(test, maskPattern);
        if (this.typeNumber >= 7) this.setupTypeNumber(test);
        if (this.dataCache === null) {
            this.dataCache = QRCodeModel.createData(this.typeNumber, this.errorCorrectionLevel, this.dataList);
        }
        this.mapData(this.dataCache, maskPattern);
    },
    setupPositionProbePattern(row, col) {
        for (let r = -1; r <= 7; r++) {
            if (row + r <= -1 || this.moduleCount <= row + r) continue;
            for (let c = -1; c <= 7; c++) {
                if (col + c <= -1 || this.moduleCount <= col + c) continue;
                if (
                    (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
                    (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
                    (2 <= r && r <= 4 && 2 <= c && c <= 4)
                ) {
                    this.modules[row + r][col + c] = true;
                } else {
                    this.modules[row + r][col + c] = false;
                }
            }
        }
    },
    getBestMaskPattern() {
        let minLostPoint = 0;
        let pattern = 0;
        for (let i = 0; i < 8; i++) {
            this.makeImpl(true, i);
            const lostPoint = QRUtil.getLostPoint(this);
            if (i === 0 || minLostPoint > lostPoint) {
                minLostPoint = lostPoint;
                pattern = i;
            }
        }
        return pattern;
    },
    setupTimingPattern() {
        for (let r = 8; r < this.moduleCount - 8; r++) {
            if (this.modules[r][6] !== null) continue;
            this.modules[r][6] = r % 2 === 0;
        }
        for (let c = 8; c < this.moduleCount - 8; c++) {
            if (this.modules[6][c] !== null) continue;
            this.modules[6][c] = c % 2 === 0;
        }
    },
    setupPositionAdjustPattern() {
        const pos = QRUtil.getPatternPosition(this.typeNumber);
        for (let i = 0; i < pos.length; i++) {
            for (let j = 0; j < pos.length; j++) {
                const row = pos[i];
                const col = pos[j];
                if (this.modules[row][col] !== null) continue;
                for (let r = -2; r <= 2; r++) {
                    for (let c = -2; c <= 2; c++) {
                        if (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0)) {
                            this.modules[row + r][col + c] = true;
                        } else {
                            this.modules[row + r][col + c] = false;
                        }
                    }
                }
            }
        }
    },
    setupTypeInfo(test, maskPattern) {
        const data = (this.errorCorrectionLevel << 3) | maskPattern;
        const bits = QRUtil.getBCHTypeInfo(data);
        for (let i = 0; i < 15; i++) {
            const mod = !test && ((bits >> i) & 1) === 1;
            if (i < 6) this.modules[i][8] = mod;
            else if (i < 8) this.modules[i + 1][8] = mod;
            else this.modules[this.moduleCount - 15 + i][8] = mod;
            if (i < 8) this.modules[8][this.moduleCount - i - 1] = mod;
            else if (i < 9) this.modules[8][15 - i - 1 + 1] = mod;
            else this.modules[8][15 - i - 1] = mod;
        }
        this.modules[this.moduleCount - 8][8] = !test;
    },
    setupTypeNumber(test) {
        const bits = QRUtil.getBCHTypeNumber(this.typeNumber);
        for (let i = 0; i < 18; i++) {
            const mod = !test && ((bits >> i) & 1) === 1;
            this.modules[Math.floor(i / 3)][(i % 3) + this.moduleCount - 8 - 3] = mod;
            this.modules[(i % 3) + this.moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
        }
    },
    mapData(data, maskPattern) {
        let inc = -1;
        let row = this.moduleCount - 1;
        let bitIndex = 7;
        let byteIndex = 0;
        const maskFunc = QRUtil.getMaskFunction(maskPattern);
        for (let col = this.moduleCount - 1; col > 0; col -= 2) {
            if (col === 6) col--;
            while (true) {
                for (let c = 0; c < 2; c++) {
                    if (this.modules[row][col - c] === null) {
                        let dark = false;
                        if (byteIndex < data.length) {
                            dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
                        }
                        const mask = maskFunc(row, col - c);
                        if (mask) dark = !dark;
                        this.modules[row][col - c] = dark;
                        bitIndex--;
                        if (bitIndex === -1) {
                            byteIndex++;
                            bitIndex = 7;
                        }
                    }
                }
                row += inc;
                if (row < 0 || this.moduleCount <= row) {
                    row -= inc;
                    inc = -inc;
                    break;
                }
            }
        }
    },
};

QRCodeModel.createData = function (typeNumber, errorCorrectionLevel, dataList) {
    const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);
    const buffer = new QRBitBuffer();
    for (let i = 0; i < dataList.length; i++) {
        const data = dataList[i];
        buffer.put(data.mode, 4);
        buffer.put(data.getLength(), typeNumber < 10 ? 8 : 16);
        data.write(buffer);
    }
    let totalDataCount = 0;
    for (let i = 0; i < rsBlocks.length; i++) totalDataCount += rsBlocks[i].dataCount;
    if (buffer.length > totalDataCount * 8) {
        throw new Error('Code length overflow. (' + buffer.length + '>' + totalDataCount * 8 + ')');
    }
    if (buffer.length + 4 <= totalDataCount * 8) buffer.put(0, 4);
    while (buffer.length % 8 !== 0) buffer.putBit(false);
    while (true) {
        if (buffer.length >= totalDataCount * 8) break;
        buffer.put(0xec, 8);
        if (buffer.length >= totalDataCount * 8) break;
        buffer.put(0x11, 8);
    }
    return QRCodeModel.createBytes(buffer, rsBlocks);
};

QRCodeModel.createBytes = function (buffer, rsBlocks) {
    let offset = 0;
    let maxDcCount = 0;
    let maxEcCount = 0;
    const dcdata = new Array(rsBlocks.length);
    const ecdata = new Array(rsBlocks.length);
    for (let r = 0; r < rsBlocks.length; r++) {
        const dcCount = rsBlocks[r].dataCount;
        const ecCount = rsBlocks[r].totalCount - dcCount;
        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);
        dcdata[r] = new Array(dcCount);
        for (let i = 0; i < dcdata[r].length; i++) {
            dcdata[r][i] = 0xff & buffer.buffer[i + offset];
        }
        offset += dcCount;
        const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        const rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1);
        const modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (let i = 0; i < ecdata[r].length; i++) {
            const modIndex = i + modPoly.getLength() - ecdata[r].length;
            ecdata[r][i] = modIndex >= 0 ? modPoly.get(modIndex) : 0;
        }
    }
    let totalCodeCount = 0;
    for (let i = 0; i < rsBlocks.length; i++) totalCodeCount += rsBlocks[i].totalCount;
    const data = new Array(totalCodeCount);
    let index = 0;
    for (let i = 0; i < maxDcCount; i++) {
        for (let r = 0; r < rsBlocks.length; r++) {
            if (i < dcdata[r].length) data[index++] = dcdata[r][i];
        }
    }
    for (let i = 0; i < maxEcCount; i++) {
        for (let r = 0; r < rsBlocks.length; r++) {
            if (i < ecdata[r].length) data[index++] = ecdata[r][i];
        }
    }
    return data;
};

const QRUtil = {
    PATTERN_POSITION_TABLE: [
        [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
        [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
        [6, 30, 54]
    ],
    getPatternPosition(typeNumber) {
        return QRUtil.PATTERN_POSITION_TABLE[typeNumber - 1] || [];
    },
    getMaskFunction(maskPattern) {
        switch (maskPattern) {
            case QRMaskPattern.PATTERN000: return (i, j) => (i + j) % 2 === 0;
            case QRMaskPattern.PATTERN001: return (i) => i % 2 === 0;
            case QRMaskPattern.PATTERN010: return (i, j) => j % 3 === 0;
            case QRMaskPattern.PATTERN011: return (i, j) => (i + j) % 3 === 0;
            case QRMaskPattern.PATTERN100: return (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
            case QRMaskPattern.PATTERN101: return (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0;
            case QRMaskPattern.PATTERN110: return (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
            case QRMaskPattern.PATTERN111: return (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0;
            default: throw new Error('bad maskPattern:' + maskPattern);
        }
    },
    getErrorCorrectPolynomial(errorCorrectLength) {
        let a = new QRPolynomial([1], 0);
        for (let i = 0; i < errorCorrectLength; i++) {
            a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0));
        }
        return a;
    },
    getBCHTypeInfo(data) {
        let d = data << 10;
        while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(1335) >= 0) {
            d ^= 1335 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(1335));
        }
        return ((data << 10) | d) ^ 21522;
    },
    getBCHTypeNumber(data) {
        let d = data << 12;
        while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(7973) >= 0) {
            d ^= 7973 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(7973));
        }
        return (data << 12) | d;
    },
    getBCHDigit(data) {
        let digit = 0;
        while (data !== 0) {
            digit++;
            data >>>= 1;
        }
        return digit;
    },
    getLostPoint(qrCode) {
        const moduleCount = qrCode.getModuleCount();
        let lostPoint = 0;
        for (let row = 0; row < moduleCount; row++) {
            for (let col = 0; col < moduleCount; col++) {
                let sameCount = 0;
                const dark = qrCode.isDark(row, col);
                for (let r = -1; r <= 1; r++) {
                    if (row + r < 0 || moduleCount <= row + r) continue;
                    for (let c = -1; c <= 1; c++) {
                        if (col + c < 0 || moduleCount <= col + c) continue;
                        if (r === 0 && c === 0) continue;
                        if (dark === qrCode.isDark(row + r, col + c)) sameCount++;
                    }
                }
                if (sameCount > 5) lostPoint += 3 + sameCount - 5;
            }
        }
        return lostPoint;
    },
};

/**
 * Generate QR SVG data string
 */
export function generateQRCodeSvg(text, options = {}) {
    const {
        errorCorrection = 'M',
        fgColor = '#000000',
        bgColor = '#ffffff',
        margin = 2,
    } = options;

    const ecLevel = QRErrorCorrectionLevel[errorCorrection] ?? QRErrorCorrectionLevel.M;
    const qr = new QRCodeModel(0, ecLevel);
    qr.addData(text || ' ');
    qr.make();

    const count = qr.getModuleCount();
    const size = count + margin * 2;
    let paths = '';

    for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
            if (qr.isDark(r, c)) {
                paths += `M${c + margin},${r + margin}h1v1h-1z `;
            }
        }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">
        <rect width="${size}" height="${size}" fill="${bgColor}" />
        <path d="${paths}" fill="${fgColor}" />
    </svg>`;
}

/**
 * Generate QR PNG Data URL using HTML5 Canvas
 */
export function generateQRCodeDataUrl(text, options = {}) {
    const {
        errorCorrection = 'M',
        fgColor = '#000000',
        bgColor = '#ffffff',
        margin = 2,
        width = 256,
    } = options;

    if (typeof document === 'undefined') return '';

    const ecLevel = QRErrorCorrectionLevel[errorCorrection] ?? QRErrorCorrectionLevel.M;
    const qr = new QRCodeModel(0, ecLevel);
    qr.addData(text || ' ');
    qr.make();

    const count = qr.getModuleCount();
    const totalModules = count + margin * 2;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = width;
    const ctx = canvas.getContext('2d');

    // Fill background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, width);

    // Draw dark modules
    ctx.fillStyle = fgColor;
    const moduleSize = width / totalModules;

    for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
            if (qr.isDark(r, c)) {
                const x = Math.round((c + margin) * moduleSize);
                const y = Math.round((r + margin) * moduleSize);
                const w = Math.ceil(moduleSize);
                const h = Math.ceil(moduleSize);
                ctx.fillRect(x, y, w, h);
            }
        }
    }

    return canvas.toDataURL('image/png');
}
