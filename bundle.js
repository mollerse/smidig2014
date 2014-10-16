(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')

exports.Buffer = Buffer
exports.SlowBuffer = Buffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192

/**
 * If `TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Note:
 *
 * - Implementation must support adding new properties to `Uint8Array` instances.
 *   Firefox 4-29 lacked support, fixed in Firefox 30+.
 *   See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *  - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *  - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *    incorrect length in some situations.
 *
 * We detect these buggy browsers and set `TYPED_ARRAY_SUPPORT` to `false` so they will
 * get the Object implementation, which is slower but will work correctly.
 */
var TYPED_ARRAY_SUPPORT = (function () {
  try {
    var buf = new ArrayBuffer(0)
    var arr = new Uint8Array(buf)
    arr.foo = function () { return 42 }
    return 42 === arr.foo() && // typed array instances can be augmented
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        new Uint8Array(1).subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
})()

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (subject, encoding, noZero) {
  if (!(this instanceof Buffer))
    return new Buffer(subject, encoding, noZero)

  var type = typeof subject

  // Find the length
  var length
  if (type === 'number')
    length = subject > 0 ? subject >>> 0 : 0
  else if (type === 'string') {
    if (encoding === 'base64')
      subject = base64clean(subject)
    length = Buffer.byteLength(subject, encoding)
  } else if (type === 'object' && subject !== null) { // assume object is array-like
    if (subject.type === 'Buffer' && isArray(subject.data))
      subject = subject.data
    length = +subject.length > 0 ? Math.floor(+subject.length) : 0
  } else
    throw new Error('First argument needs to be a number, array or string.')

  var buf
  if (TYPED_ARRAY_SUPPORT) {
    // Preferred: Return an augmented `Uint8Array` instance for best performance
    buf = Buffer._augment(new Uint8Array(length))
  } else {
    // Fallback: Return THIS instance of Buffer (created by `new`)
    buf = this
    buf.length = length
    buf._isBuffer = true
  }

  var i
  if (TYPED_ARRAY_SUPPORT && typeof subject.byteLength === 'number') {
    // Speed optimization -- use set if we're copying from a typed array
    buf._set(subject)
  } else if (isArrayish(subject)) {
    // Treat array-ish objects as a byte array
    if (Buffer.isBuffer(subject)) {
      for (i = 0; i < length; i++)
        buf[i] = subject.readUInt8(i)
    } else {
      for (i = 0; i < length; i++)
        buf[i] = ((subject[i] % 256) + 256) % 256
    }
  } else if (type === 'string') {
    buf.write(subject, 0, encoding)
  } else if (type === 'number' && !TYPED_ARRAY_SUPPORT && !noZero) {
    for (i = 0; i < length; i++) {
      buf[i] = 0
    }
  }

  return buf
}

// STATIC METHODS
// ==============

Buffer.isEncoding = function (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.isBuffer = function (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.byteLength = function (str, encoding) {
  var ret
  str = str.toString()
  switch (encoding || 'utf8') {
    case 'hex':
      ret = str.length / 2
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8ToBytes(str).length
      break
    case 'ascii':
    case 'binary':
    case 'raw':
      ret = str.length
      break
    case 'base64':
      ret = base64ToBytes(str).length
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = str.length * 2
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.concat = function (list, totalLength) {
  assert(isArray(list), 'Usage: Buffer.concat(list[, length])')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (totalLength === undefined) {
    totalLength = 0
    for (i = 0; i < list.length; i++) {
      totalLength += list[i].length
    }
  }

  var buf = new Buffer(totalLength)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

Buffer.compare = function (a, b) {
  assert(Buffer.isBuffer(a) && Buffer.isBuffer(b), 'Arguments must be Buffers')
  var x = a.length
  var y = b.length
  for (var i = 0, len = Math.min(x, y); i < len && a[i] === b[i]; i++) {}
  if (i !== len) {
    x = a[i]
    y = b[i]
  }
  if (x < y) {
    return -1
  }
  if (y < x) {
    return 1
  }
  return 0
}

// BUFFER INSTANCE METHODS
// =======================

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  assert(strLen % 2 === 0, 'Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var byte = parseInt(string.substr(i * 2, 2), 16)
    assert(!isNaN(byte), 'Invalid hex string')
    buf[offset + i] = byte
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf8ToBytes(string), buf, offset, length)
  return charsWritten
}

function asciiWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(asciiToBytes(string), buf, offset, length)
  return charsWritten
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(base64ToBytes(string), buf, offset, length)
  return charsWritten
}

function utf16leWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf16leToBytes(string), buf, offset, length)
  return charsWritten
}

Buffer.prototype.write = function (string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length
      length = undefined
    }
  } else {  // legacy
    var swap = encoding
    encoding = offset
    offset = length
    length = swap
  }

  offset = Number(offset) || 0
  var remaining = this.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase()

  var ret
  switch (encoding) {
    case 'hex':
      ret = hexWrite(this, string, offset, length)
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8Write(this, string, offset, length)
      break
    case 'ascii':
      ret = asciiWrite(this, string, offset, length)
      break
    case 'binary':
      ret = binaryWrite(this, string, offset, length)
      break
    case 'base64':
      ret = base64Write(this, string, offset, length)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = utf16leWrite(this, string, offset, length)
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.prototype.toString = function (encoding, start, end) {
  var self = this

  encoding = String(encoding || 'utf8').toLowerCase()
  start = Number(start) || 0
  end = (end === undefined) ? self.length : Number(end)

  // Fastpath empty strings
  if (end === start)
    return ''

  var ret
  switch (encoding) {
    case 'hex':
      ret = hexSlice(self, start, end)
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8Slice(self, start, end)
      break
    case 'ascii':
      ret = asciiSlice(self, start, end)
      break
    case 'binary':
      ret = binarySlice(self, start, end)
      break
    case 'base64':
      ret = base64Slice(self, start, end)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = utf16leSlice(self, start, end)
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.prototype.toJSON = function () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

Buffer.prototype.equals = function (b) {
  assert(Buffer.isBuffer(b), 'Argument must be a Buffer')
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.compare = function (b) {
  assert(Buffer.isBuffer(b), 'Argument must be a Buffer')
  return Buffer.compare(this, b)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function (target, target_start, start, end) {
  var source = this

  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (!target_start) target_start = 0

  // Copy 0 bytes; we're done
  if (end === start) return
  if (target.length === 0 || source.length === 0) return

  // Fatal error conditions
  assert(end >= start, 'sourceEnd < sourceStart')
  assert(target_start >= 0 && target_start < target.length,
      'targetStart out of bounds')
  assert(start >= 0 && start < source.length, 'sourceStart out of bounds')
  assert(end >= 0 && end <= source.length, 'sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length)
    end = this.length
  if (target.length - target_start < end - start)
    end = target.length - target_start + start

  var len = end - start

  if (len < 100 || !TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < len; i++) {
      target[i + target_start] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), target_start)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function binarySlice (buf, start, end) {
  return asciiSlice(buf, start, end)
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len;
    if (start < 0)
      start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0)
      end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start)
    end = start

  if (TYPED_ARRAY_SUPPORT) {
    return Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    var newBuf = new Buffer(sliceLen, undefined, true)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
    return newBuf
  }
}

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
Buffer.prototype.set = function (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

Buffer.prototype.readUInt8 = function (offset, noAssert) {
  if (!noAssert) {
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'Trying to read beyond buffer length')
  }

  if (offset >= this.length)
    return

  return this[offset]
}

function readUInt16 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val
  if (littleEndian) {
    val = buf[offset]
    if (offset + 1 < len)
      val |= buf[offset + 1] << 8
  } else {
    val = buf[offset] << 8
    if (offset + 1 < len)
      val |= buf[offset + 1]
  }
  return val
}

Buffer.prototype.readUInt16LE = function (offset, noAssert) {
  return readUInt16(this, offset, true, noAssert)
}

Buffer.prototype.readUInt16BE = function (offset, noAssert) {
  return readUInt16(this, offset, false, noAssert)
}

function readUInt32 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val
  if (littleEndian) {
    if (offset + 2 < len)
      val = buf[offset + 2] << 16
    if (offset + 1 < len)
      val |= buf[offset + 1] << 8
    val |= buf[offset]
    if (offset + 3 < len)
      val = val + (buf[offset + 3] << 24 >>> 0)
  } else {
    if (offset + 1 < len)
      val = buf[offset + 1] << 16
    if (offset + 2 < len)
      val |= buf[offset + 2] << 8
    if (offset + 3 < len)
      val |= buf[offset + 3]
    val = val + (buf[offset] << 24 >>> 0)
  }
  return val
}

Buffer.prototype.readUInt32LE = function (offset, noAssert) {
  return readUInt32(this, offset, true, noAssert)
}

Buffer.prototype.readUInt32BE = function (offset, noAssert) {
  return readUInt32(this, offset, false, noAssert)
}

Buffer.prototype.readInt8 = function (offset, noAssert) {
  if (!noAssert) {
    assert(offset !== undefined && offset !== null,
        'missing offset')
    assert(offset < this.length, 'Trying to read beyond buffer length')
  }

  if (offset >= this.length)
    return

  var neg = this[offset] & 0x80
  if (neg)
    return (0xff - this[offset] + 1) * -1
  else
    return this[offset]
}

function readInt16 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val = readUInt16(buf, offset, littleEndian, true)
  var neg = val & 0x8000
  if (neg)
    return (0xffff - val + 1) * -1
  else
    return val
}

Buffer.prototype.readInt16LE = function (offset, noAssert) {
  return readInt16(this, offset, true, noAssert)
}

Buffer.prototype.readInt16BE = function (offset, noAssert) {
  return readInt16(this, offset, false, noAssert)
}

function readInt32 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val = readUInt32(buf, offset, littleEndian, true)
  var neg = val & 0x80000000
  if (neg)
    return (0xffffffff - val + 1) * -1
  else
    return val
}

Buffer.prototype.readInt32LE = function (offset, noAssert) {
  return readInt32(this, offset, true, noAssert)
}

Buffer.prototype.readInt32BE = function (offset, noAssert) {
  return readInt32(this, offset, false, noAssert)
}

function readFloat (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  return ieee754.read(buf, offset, littleEndian, 23, 4)
}

Buffer.prototype.readFloatLE = function (offset, noAssert) {
  return readFloat(this, offset, true, noAssert)
}

Buffer.prototype.readFloatBE = function (offset, noAssert) {
  return readFloat(this, offset, false, noAssert)
}

function readDouble (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset + 7 < buf.length, 'Trying to read beyond buffer length')
  }

  return ieee754.read(buf, offset, littleEndian, 52, 8)
}

Buffer.prototype.readDoubleLE = function (offset, noAssert) {
  return readDouble(this, offset, true, noAssert)
}

Buffer.prototype.readDoubleBE = function (offset, noAssert) {
  return readDouble(this, offset, false, noAssert)
}

Buffer.prototype.writeUInt8 = function (value, offset, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'trying to write beyond buffer length')
    verifuint(value, 0xff)
  }

  if (offset >= this.length) return

  this[offset] = value
  return offset + 1
}

function writeUInt16 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'trying to write beyond buffer length')
    verifuint(value, 0xffff)
  }

  var len = buf.length
  if (offset >= len)
    return

  for (var i = 0, j = Math.min(len - offset, 2); i < j; i++) {
    buf[offset + i] =
        (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
            (littleEndian ? i : 1 - i) * 8
  }
  return offset + 2
}

Buffer.prototype.writeUInt16LE = function (value, offset, noAssert) {
  return writeUInt16(this, value, offset, true, noAssert)
}

Buffer.prototype.writeUInt16BE = function (value, offset, noAssert) {
  return writeUInt16(this, value, offset, false, noAssert)
}

function writeUInt32 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'trying to write beyond buffer length')
    verifuint(value, 0xffffffff)
  }

  var len = buf.length
  if (offset >= len)
    return

  for (var i = 0, j = Math.min(len - offset, 4); i < j; i++) {
    buf[offset + i] =
        (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
  return offset + 4
}

Buffer.prototype.writeUInt32LE = function (value, offset, noAssert) {
  return writeUInt32(this, value, offset, true, noAssert)
}

Buffer.prototype.writeUInt32BE = function (value, offset, noAssert) {
  return writeUInt32(this, value, offset, false, noAssert)
}

Buffer.prototype.writeInt8 = function (value, offset, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7f, -0x80)
  }

  if (offset >= this.length)
    return

  if (value >= 0)
    this.writeUInt8(value, offset, noAssert)
  else
    this.writeUInt8(0xff + value + 1, offset, noAssert)
  return offset + 1
}

function writeInt16 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7fff, -0x8000)
  }

  var len = buf.length
  if (offset >= len)
    return

  if (value >= 0)
    writeUInt16(buf, value, offset, littleEndian, noAssert)
  else
    writeUInt16(buf, 0xffff + value + 1, offset, littleEndian, noAssert)
  return offset + 2
}

Buffer.prototype.writeInt16LE = function (value, offset, noAssert) {
  return writeInt16(this, value, offset, true, noAssert)
}

Buffer.prototype.writeInt16BE = function (value, offset, noAssert) {
  return writeInt16(this, value, offset, false, noAssert)
}

function writeInt32 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7fffffff, -0x80000000)
  }

  var len = buf.length
  if (offset >= len)
    return

  if (value >= 0)
    writeUInt32(buf, value, offset, littleEndian, noAssert)
  else
    writeUInt32(buf, 0xffffffff + value + 1, offset, littleEndian, noAssert)
  return offset + 4
}

Buffer.prototype.writeInt32LE = function (value, offset, noAssert) {
  return writeInt32(this, value, offset, true, noAssert)
}

Buffer.prototype.writeInt32BE = function (value, offset, noAssert) {
  return writeInt32(this, value, offset, false, noAssert)
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to write beyond buffer length')
    verifIEEE754(value, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }

  var len = buf.length
  if (offset >= len)
    return

  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 7 < buf.length,
        'Trying to write beyond buffer length')
    verifIEEE754(value, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }

  var len = buf.length
  if (offset >= len)
    return

  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  assert(end >= start, 'end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  assert(start >= 0 && start < this.length, 'start out of bounds')
  assert(end >= 0 && end <= this.length, 'end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

Buffer.prototype.inspect = function () {
  var out = []
  var len = this.length
  for (var i = 0; i < len; i++) {
    out[i] = toHex(this[i])
    if (i === exports.INSPECT_MAX_BYTES) {
      out[i + 1] = '...'
      break
    }
  }
  return '<Buffer ' + out.join(' ') + '>'
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function () {
  if (typeof Uint8Array !== 'undefined') {
    if (TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new Error('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function (arr) {
  arr._isBuffer = true

  // save reference to original Uint8Array get/set methods before overwriting
  arr._get = arr.get
  arr._set = arr.set

  // deprecated, will be removed in node 0.13+
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-z]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function isArray (subject) {
  return (Array.isArray || function (subject) {
    return Object.prototype.toString.call(subject) === '[object Array]'
  })(subject)
}

function isArrayish (subject) {
  return isArray(subject) || Buffer.isBuffer(subject) ||
      subject && typeof subject === 'object' &&
      typeof subject.length === 'number'
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    var b = str.charCodeAt(i)
    if (b <= 0x7F) {
      byteArray.push(b)
    } else {
      var start = i
      if (b >= 0xD800 && b <= 0xDFFF) i++
      var h = encodeURIComponent(str.slice(start, i+1)).substr(1).split('%')
      for (var j = 0; j < h.length; j++) {
        byteArray.push(parseInt(h[j], 16))
      }
    }
  }
  return byteArray
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(str)
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length))
      break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

/*
 * We have to make sure that the value is a valid integer. This means that it
 * is non-negative. It has no fractional component and that it does not
 * exceed the maximum allowed value.
 */
function verifuint (value, max) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value >= 0, 'specified a negative value for writing an unsigned value')
  assert(value <= max, 'value is larger than maximum value for type')
  assert(Math.floor(value) === value, 'value has a fractional component')
}

function verifsint (value, max, min) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value <= max, 'value larger than maximum allowed value')
  assert(value >= min, 'value smaller than minimum allowed value')
  assert(Math.floor(value) === value, 'value has a fractional component')
}

function verifIEEE754 (value, max, min) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value <= max, 'value larger than maximum allowed value')
  assert(value >= min, 'value smaller than minimum allowed value')
}

function assert (test, message) {
  if (!test) throw new Error(message || 'Failed assertion')
}

},{"base64-js":2,"ieee754":3}],2:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS)
			return 62 // '+'
		if (code === SLASH)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],3:[function(require,module,exports){
exports.read = function(buffer, offset, isLE, mLen, nBytes) {
  var e, m,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      nBits = -7,
      i = isLE ? (nBytes - 1) : 0,
      d = isLE ? -1 : 1,
      s = buffer[offset + i];

  i += d;

  e = s & ((1 << (-nBits)) - 1);
  s >>= (-nBits);
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8);

  m = e & ((1 << (-nBits)) - 1);
  e >>= (-nBits);
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8);

  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity);
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
};

exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
      i = isLE ? 0 : (nBytes - 1),
      d = isLE ? 1 : -1,
      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

  value = Math.abs(value);

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }

    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8);

  e = (e << mLen) | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8);

  buffer[offset + i - d] |= s * 128;
};

},{}],4:[function(require,module,exports){
(function (Buffer){


var slides = Buffer("PHN0eWxlPgogIC5saWdodCB7CiAgICBiYWNrZ3JvdW5kOiAjZTRlYmVlOwogICAgY29sb3I6ICMxYzIwMmI7CiAgfQoKICAuZW1waGFzaXMgewogICAgYmFja2dyb3VuZDogI2ZiNTQ0ZDsKICAgIGNvbG9yOiAjZmZmOwogIH0KCiAgLmVtcGhhc2lzIGgxLAogIC5lbXBoYXNpcyBoMiwKICAuZW1waGFzaXMgaDMsCiAgLmVtcGhhc2lzIGg0IHsKICAgIGNvbG9yOiAjMWMyMDJiOwogIH0KCiAgLmxpZ2h0IGgxLAogIC5saWdodCBoMiwKICAubGlnaHQgaDMsCiAgLmxpZ2h0IGg0IHsKICAgIGNvbG9yOiAjMWMyMDJiOwogIH0KCiAgLmRhcmsgewogICAgYmFja2dyb3VuZDogIzFjMjAyYjsKICB9CgogIC5yZXZlYWwgLnN1YnRpdGxlIHsKICAgIGZvbnQtZmFtaWx5OiAnSmFhcG9ra2ktcmVndWxhcicsIHNhbnMtc2VyaWY7CiAgfQoKICAuY2VudGVyIHsKICAgIGRpc3BsYXk6IGZsZXg7CiAgfQoKICAuY2VudGVyID4gKiB7CiAgICBtYXJnaW46IGF1dG87CiAgICB0ZXh0LWFsaWduOiBjZW50ZXIgIWltcG9ydGFudDsKICB9CgogIGgxLCBoMiwgaDMsIGg0IHsKICAgIHRleHQtYWxpZ246IGxlZnQ7CiAgfQoKICAucmV2ZWFsIHAgewogICAgZm9udC1zaXplOiAxNTAlOwogICAgdGV4dC1hbGlnbjogbGVmdDsKICB9CiAgc3Bhbi51dGhldiB7CiAgICBjb2xvcjogI2ZiNTQ0ZDsKICB9CgogIHN2ZyB7CiAgICB3aWR0aDogMjB2dzsKICAgIGhlaWdodDogNDB2dzsKICB9Cgo8L3N0eWxlPgoKPHNlY3Rpb24gY2xhc3M9ImNlbnRlciI+CiAgPGgxPk1WUFMgQUxMIFRIRSBXQVkgRE9XTjwvaDE+CiAgPGgyIGNsYXNzPSJzdWJ0aXRsZSI+RXR0IMOlciBldHRlcjwvaDI+CiAgPHA+U3RpYW4gVmV1bSBNw7hsbGVyc2VuIC8gQG1vbGxlcnNlPC9wPgogIDxwPkJFS0s8L3A+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgSGVpLiBKZWcgaGV0ZXIgU3RpYW4sIGplZyBqb2JiZXIgaSBCRUtLIGkgVHJvbmRoZWltLiBJIGRhZyBza2FsIGplZwogICAgICBmb3J0ZWxsZSBkZXJlIGxpdHQgb20gZXQgcGFyIGzDpnJlcGVuZ2VyIHZpIGhhciB0YXR0IHRpbCBvc3MgZXR0ZXIgZXQgw6VyIHDDpQogICAgICBwcm9zamVrdCBtZWQgaMO4eSBlbmRyaW5nc2ZyZWt2ZW5zIG9nIG15ZSB1c2lra2VyaGV0LgogICAgPC9wPgogIDwvYXNpZGU+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgogIDxoMT5QUk9TSkVLVEVUPC9oMT4KICA8cCBjbGFzcz0iZnJhZ21lbnQiPgogICAgVHlwaXNrIHN0YXJ0dXAtc2NlbmFyaW8uCiAgPC9wPgogIDxiciAvPgogIDxwIGNsYXNzPSJmcmFnbWVudCI+CiAgICBNw6VsZXQgZXIgw6UgYmVkcmUgb2cgZWZmZWt0aXZpc2VyZSBrb21tdW5pa2Fzam9uZW4gbWVsbG9tIHBhc2llbnQsIGxlZ2Ugb2cgc3lrZWh1cy4KICA8L3A+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgRsO4cnN0IGxpdHQgb20gc2VsdmUgcHJvc2pla3RldCwgYmFyZSBmb3Igw6UgZ2kgZGVyZSBsaXR0IGtvbnRla3N0LgogICAgICBQcm9zamVrdGV0IGVyIGkgcmVnaSBhdiBOVE5VIFRUTyBvZyBTdC4gT2xhdnMgaSBUcm9uZGhlaW0gb2cgZGV0IGVyIGV0CiAgICAgIGdhbnNrZSB0eXBpc2sgc3RhcnR1cCBzY2VuYXJpby4gTcOlbGV0IGVyIGtsYXJ0LCBtZW4gdmVpZW4gZnJlbSBlciBpa2tlCiAgICAgIGxhZ3Qgb3BwIG9nIGtvc3RuYWRlbmUgZXIgaWtrZSBkZWtrZXQuCiAgICA8L3A+CiAgICA8cD4KICAgICAgTcOlbGV0IG1lZCBwcm9zamVrdGV0IGVyIMOlIGthcnRsZWdnZSBzbWVydGUgaG9zIHBhc2llbnRlciBzb20gZ2plbm5vbWfDpXIKICAgICAgbGFuZ3ZhcmlnIGxpbmRyZW5kZSBiZWhhbmRsaW5nLiBPZyBww6UgZGVuIG3DpXRlbiBiZWRyZSBvZyBlZmZla3RpdmlzZXJlCiAgICAgIGtvbW11bmlrYXNqb25lbiBtZWxsb20gcGFzaWVudCwgbGVnZSwgb2cgc3lrZWh1cy4KICAgIDwvcD4KICA8L2FzaWRlPgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KICA8aDE+U1RBQ0tFTjwvaDE+CiAgPHAgY2xhc3M9ImZyYWdtZW50IGNlbnRlciI+CiAgICA8c3ZnIHZpZXdCb3g9IjAgMCA0MDAgODAwIiBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIj4KICAgICAgPCEtLSBGUk9OVEVORCAtLT4KICAgICAgPHJlY3QgeD0iMCIgeT0iMCIgd2lkdGg9IjQwMCIgaGVpZ2h0PSIzMDAiIHJ4PSIxNSIgcnk9IjE1IiBzdHJva2Utd2lkdGg9IjUiIHN0cm9rZT0iI2ZmZiIgZmlsbD0ibm9uZSI+PC9yZWN0PgogICAgICA8cmVjdCB4PSIyMCIgeT0iMjAiIHdpZHRoPSIzNjAiIGhlaWdodD0iMjYwIiByeD0iMTUiIHJ5PSIxNSIgc3Ryb2tlLXdpZHRoPSI1IiBzdHJva2U9IiNmZmYiIGZpbGw9Im5vbmUiPjwvcmVjdD4KICAgICAgPHRleHQgeD0iMjAwIiB5PSIxNzAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIHN0cm9rZT0iI2ZmZiIgZmlsbD0iI2ZmZiI+QW5ndWxhci5qczwvdGV4dD4KICAgICAgPCEtLSBCQUNLRU5EIC0tPgogICAgICA8cmVjdCB4PSIwIiB5PSIzMjUiIHdpZHRoPSI0MDAiIGhlaWdodD0iMjc1IiByeD0iMTUiIHJ5PSIxNSIgc3Ryb2tlLXdpZHRoPSI1IiBzdHJva2U9IiNmZmYiIGZpbGw9Im5vbmUiPjwvcmVjdD4KICAgICAgPHJlY3QgeD0iMjAiIHk9IjM0NSIgd2lkdGg9IjM2MCIgaGVpZ2h0PSI1MCIgcng9IjE1IiByeT0iMTUiIHN0cm9rZS13aWR0aD0iNSIgc3Ryb2tlPSIjZmZmIiBmaWxsPSJub25lIj48L3JlY3Q+CiAgICAgIDx0ZXh0IHg9IjE5MCIgeT0iMzg1IiBmb250LXNpemU9IjQwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBzdHJva2U9IiNmZmYiIGZpbGw9IiNmZmYiPkMjIC5ORVQ8L3RleHQ+CiAgICAgIDxyZWN0IHg9IjIwIiB5PSI0MTAiIHdpZHRoPSIzNjAiIGhlaWdodD0iMTc1IiByeD0iMTUiIHJ5PSIxNSIgc3Ryb2tlLXdpZHRoPSI1IiBzdHJva2U9IiNmZmYiIGZpbGw9Im5vbmUiPjwvcmVjdD4KICAgICAgPHRleHQgeD0iMTkwIiB5PSI1MjUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIHN0cm9rZT0iI2ZmZiIgZmlsbD0iI2ZmZiI+RiM8L3RleHQ+CgogICAgICA8IS0tIERBVEFCQVNFIC0tPgogICAgICA8cmVjdCB4PSIwIiB5PSI2MjUiIHdpZHRoPSI0MDAiIGhlaWdodD0iMTc1IiByeD0iMTUiIHJ5PSIxNSIgc3Ryb2tlLXdpZHRoPSI1IiBzdHJva2U9IiNmZmYiIGZpbGw9Im5vbmUiPjwvcmVjdD4KICAgICAgPHJlY3QgeD0iMjAiIHk9IjY0MCIgd2lkdGg9IjE3MCIgaGVpZ2h0PSIxNDUiIHJ4PSIxNSIgcnk9IjE1IiBzdHJva2Utd2lkdGg9IjUiIHN0cm9rZT0iI2ZmZiIgZmlsbD0ibm9uZSI+PC9yZWN0PgogICAgICA8dGV4dCB4PSIxMDUiIHk9IjcwMi41IiBmb250LXNpemU9IjQwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBzdHJva2U9IiNmZmYiIGZpbGw9IiNmZmYiPlNwcmVhZC08L3RleHQ+CiAgICAgIDx0ZXh0IHg9IjEwNSIgeT0iNzQyLjUiIGZvbnQtc2l6ZT0iNDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIHN0cm9rZT0iI2ZmZiIgZmlsbD0iI2ZmZiI+c2hlZXQ8L3RleHQ+CiAgICAgIDxyZWN0IHg9IjIxMCIgeT0iNjQwIiB3aWR0aD0iMTcwIiBoZWlnaHQ9IjE0NSIgcng9IjE1IiByeT0iMTUiIHN0cm9rZS13aWR0aD0iNSIgc3Ryb2tlPSIjZmZmIiBmaWxsPSJub25lIj48L3JlY3Q+CiAgICAgIDx0ZXh0IHg9IjI5NSIgeT0iNzAyLjUiIGZvbnQtc2l6ZT0iNDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIHN0cm9rZT0iI2ZmZiIgZmlsbD0iI2ZmZiI+QXp1cmU8L3RleHQ+CiAgICAgIDx0ZXh0IHg9IjI5NSIgeT0iNzQyLjUiIGZvbnQtc2l6ZT0iNDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIHN0cm9rZT0iI2ZmZiIgZmlsbD0iI2ZmZiI+QmxvYlN0b3JlPC90ZXh0PgogICAgPC9zdmc+CiAgPC9wPgogIDxhc2lkZSBjbGFzcz0ibm90ZXMiPgogICAgPHA+CiAgICAgIFRla25vbG9naXN0YWNrZW4gdmkgb3BlcmVyZXIgbWVkIGVuIGkgaG92ZWRzYWsgZW4gLk5FVCBzdGFjaywgbWVkIGVuCiAgICAgIHN0b3IgRiMgYml0LiBEZW4gc2VydmVyIGVuIFNQQSwgaHZvciBtZXN0ZXBhcnRlbiBhdiBmdW5rc2pvbmFsaXRldGVuCiAgICAgIGxpZ2dlci4gRGV0IHNuYWtrZXMgaSBKU09OIG9nIHZpIGhhciB0byBmb3Jza2plbGxpZ2UgZGF0YXN0b3Jlcy4KICAgIDwvcD4KICAgIDxwPgogICAgICBQcm9zamVrdGV0IGJlc3TDpXIgcGRkIGF2IHRyZSBhcHBsaWthc2pvbmVyLCBodm9yIGFsbGUgYmVueXR0ZXIgZGVuIHNhbW1lCiAgICAgIHN0YWNrZW4uCiAgICA8L3A+CiAgPC9hc2lkZT4KPC9zZWN0aW9uPgoKPHNlY3Rpb24gY2xhc3M9ImNlbnRlciI+CiAgPGgxPlZBTEdFTkU8L2gxPgogIDxhc2lkZSBjbGFzcz0ibm90ZXMiPgogICAgPHA+CiAgICAgIFPDpSB0aWwgZGV0IHNvbSBlciBmb2t1c2V0IGZvciBpbm5sZWdnZXQuIFZhbGdlbmUgdmkgaGFyIHRhdHQuIE92ZXIgZGV0CiAgICAgIHNpc3RlIMOlcmV0IGhhciB2aSBpbm5zZXR0IGF0IGVua2VsdGUgYXYgdmFsZ2VuZSB2aSBnam9yZGUgcMOlIHZlaWVuIGlra2UKICAgICAgdmFyIGhlbHQgb3B0aW1hbGUuIEJlZ3JlbnNuaW5nZXIgbGFndCBhdiB2YWxnIHNvbSBibGUgZ2pvcnQgZm9yIGVuIHRpZAogICAgICB0aWxiYWtlIGhhciBnam9ydCBhdCBpa2tlIGFsbGUgZW5kcmluZ2VyIGVyIGxpa2UgZW5rbGUgw6UgZsOlIHRpbC4KICAgIDwvcD4KICAgIDxwPgogICAgICBEZXQgamVnIMO4bnNrZXIgw6UgZ2rDuHJlIGkgZGFnIGVyIMOlIHNlIG7DpnJtZXJlIHDDpSBub2VuIGF2IHZhbGdlbmUgdmkgZ2pvcmRlCiAgICAgIHVuZGVydmVpcy4gU8OlIGthbiB2aSwgZ2plbm5vbSDDpSBzZSBww6Ugw6Vyc2FrZW4gdGlsIGF0IHZhbGdldCBmdW5nZXJ0ZSBlbGxlcgogICAgICBmZWlsZXQsIHRyZWtrZSB1dCBub2UgbMOmcmRvbSB2aSBrYW4gdGEgbWVkIG9zcyBww6UgdmVpZW4gdmlkZXJlLgogICAgPC9wPgogIDwvYXNpZGU+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uIGNsYXNzPSJsaWdodCBjZW50ZXIiIGRhdGEtYmFja2dyb3VuZD0iI2U0ZWJlZSI+CiAgPGgxPkh2aWxrZSA8c3BhbiBjbGFzcz0idXRoZXYiPmbDuGxnZXI8L3NwYW4+IGbDpXIgZXR0IGVua2VsdCA8c3BhbiBjbGFzcz0idXRoZXYiPnZhbGc8L3NwYW4+PzwvaDE+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgRm9yIMOlIGFuYWx5c2VyZSBkZXQgZW5rZWx0ZSB2YWxnIHNrYWwgdmkgc2UgcMOlIGh2aWxrZSBmw7hsZ2VyIHZhbGdldCBmaWtrCiAgICAgIGZvciBodm9yZGFuIGVua2VsdCB2aSBrYW4gbW9kZWxsZXJlIG55ZSBwcm9ibGVtc3RpbGxpbmdlciBlbGxlciBnasO4cmUKICAgICAgZW5kcmluZ2VyIHDDpSBla3Npc3RlcmVuZGUga29kZS4KICAgIDwvcD4KICAgIDxwPgogICAgICBIYWRkZSBldCB2YWxnIHVoZWxkaWdlIGbDuGxnZXIgc29tIGdqb3JkZSBkZXQgbWVyIGtvbXBsaXNlcnQgw6UgdGlscGFzc2UKICAgICAgbMO4c25pbmdlbiB0aWwgbnllIHByb2JsZW1zdGlsbGluZ2VyPyBHam9yZGUgZXQgdmFsZyBkZXQgZW5rbGVyZSDDpSBlbmRyZSBww6UKICAgICAgb3BwZsO4cnNsZW4gdGlsIHN5c3RlbWV0PwogICAgPC9wPgogICAgPHA+CiAgICAgIEplZyBza2FsIGfDpSBpZ2plbm5vbSA0IHZhbGcgb2cgc2UgcMOlIGh2aWxrZSBmw7hsZ2VyIGRldCBmaWtrIGZvciBtw6V0ZW4gdmkKICAgICAga3VubmUgZW5kcmUgZWxsZXIgbGVnZ2UgdGlsIG55IGZ1bmtzam9uYWxpdGV0LgogICAgPC9wPgogIDwvYXNpZGU+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uIGRhdGEtYmFja2dyb3VuZD0iI2ZiNTQ0ZCIgY2xhc3M9ImNlbnRlciBlbXBoYXNpcyI+CiAgPHA+VmFsZyAxOjwvcD4KICA8aDE+U3ByZWFkc2hlZXQgQmFja2VuZDwvaDE+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgRGV0IGbDuHJzdGUgdmFsZ2V0IHZpIHNrYWwgc2UgcMOlIGVyIHZhbGdldCBhdiBnb29nbGUgc3ByZWFkc2hlZXRzIHNvbQogICAgICBiYWNrZW5kIGZvciBlbiBkZWwgYXYgZGF0YWVuZSB2aSBicnVrZXIgaSBhcHBsaWthc2pvbmVuZS4gTWluIGtvbGxlZ2EKICAgICAgSm9uYXMgdmFyIGhlciBww6UgU21pZGlnIGkgZmpvciBvZyBzbmFra2V0IG9tIGFra3VyYXQgZGV0dGUuCiAgICA8L3A+CiAgPC9hc2lkZT4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CiAgPGgyPlNwcmVhZHNoZWV0IEJhY2tlbmQ8L2gyPgogIDxwIGNsYXNzPSJmcmFnbWVudCI+CiAgICBBbHQgbcOlIG1vZGVsbGVyZXMgc29tIHRhYnVsw6ZyZSBkYXRhLgogIDwvcD4KICA8YnIgLz4KICA8cCBjbGFzcz0iZnJhZ21lbnQiPgogICAgRGF0YWVuZSBpIHJlZ25lYXJrZXQgbcOlIG92ZXJzZXR0ZXMgdGlsIGV0IGFubmV0IGZvcm1hdCBmb3IgYnJ1ay4KICA8L3A+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgSHZpbGtlIGbDuGxnZXIgaGFyIHZhbGdldCBhdiBzcHJlYWRzaGVldCBzb20gYmFja2VuZCBmb3IgbcOldGVuIHZpCiAgICAgIGthbiBsw7hzZSBwcm9ibGVtc3RpbGxpZ2VuZSB2w6VyZT8gRGVuIGbDuHJzdGUgZsO4bGdlbiBlciBhdCBhbGxlIGRhdGEKICAgICAgbcOlIGt1bm5lIG1vZGVsbGVyZXMgc29tIHRhYnVsw6ZyZSBkYXRhLgogICAgPC9wPgogICAgPHA+CiAgICAgIERlbiBhbmRyZSBmw7hsZ2VuIGVyIGF0IGRhdGFlbmUgbsOlIGxldmVyIHDDpSBldCBzdGVkIHV0ZW5mb3Iga29kZW4gdsOlciBvZwogICAgICBkZXJtZWQgbcOlIG92ZXJzZXR0ZXMgdGlsIGV0IGFubmV0IGZvcm1hdCBmw7hyIHZpIGthbiBicnVrZSBkZW0gdmlkZXJlIGkKICAgICAgcHJvZ3JhbW1ldC4KICAgIDwvcD4KICA8L2FzaWRlPgo8L3NlY3Rpb24+Cgo8c2VjdGlvbiBkYXRhLWJhY2tncm91bmQ9IiNmYjU0NGQiIGNsYXNzPSJjZW50ZXIgZW1waGFzaXMiPgogIDxwPlZhbGcgMjo8L3A+CiAgPGgxPkFuZ3VsYXIuanMgZGlyZWN0aXZlczwvaDE+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgRGV0IGFuZHJlIHZhbGdldCB2YXIgw6UgYnJ1a2UgYW5ndWxhci5qcyBzb20gcmFtbWV2ZXJrIGZvciBmcm9udGVuZGVuIHbDpXIuCiAgICAgIE9nIG1lciBzcGVzaWZpa3QgQW5ndWxhciBEaXJlY3RpdmVzLCBzb20gZXIgZW4gYWJzdHJha3Nqb24gZm9yIMOlIGxhZ2UgVUkKICAgICAga29tcG9uZW50ZXIuCiAgICA8L3A+CiAgPC9hc2lkZT4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CiAgPGgyPkFuZ3VsYXIuanMgZGlyZWN0aXZlczwvaDI+CiAgPHAgY2xhc3M9ImZyYWdtZW50Ij4KICAgIEFsbGUgVUkgZWxlbWVudGVyIG1vZGVsbGVyZXMgc29tIEFuZ3VsYXIgZGlyZWN0aXZlcy4KICA8L3A+CiAgPGJyIC8+CiAgPHAgY2xhc3M9ImZyYWdtZW50Ij4KICAgIEFsbCBVSS1yZWxhdGVydCBsb2dpa2sgbcOlIG1vZGVsbGVyZXMgcMOlIEFuZ3VsYXJzIHByZW1pc3Nlci4KICA8L3A+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgRGUgZsO4bGdlbmUgZGV0dGUgdmFsZ2V0IGZpa2sgdmFyIGF0IHZpIG7DpSB2YXIgbsO4ZHQgdGlsIMOlIGtvZGUgYWxsZSBVSQogICAgICBrb21wb25lbnRlciBww6UgZGVubmUgbcOldGVuLCBmb3IgYXQgZGUgc2t1bGxlIGt1bm5lIGtvbXBvbmVyZXMgb2cgc25ha2tlCiAgICAgIHNhbW1lbi4KICAgIDwvcD4KICAgIDxwPgogICAgICBEZW4gYW5kcmUgZsO4bGdlbiB2YXIgYXQgdmkgbsOlIG9nc8OlIHZhciBuw7hkdCB0aWwgw6Ugc2tyaXZlIFVJLXJlbGF0ZXJ0CiAgICAgIGxvZ2lrayBww6UgZW4gc2xpayBtw6V0ZSBhdCBkZSBrdW5uZSBzYW1hcmJlaWRlIG1lZCBkZSBrb21wb25lbnRlbmUgdmkKICAgICAgYnJ1a3RlLgogICAgPC9wPgogIDwvYXNpZGU+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uIGRhdGEtYmFja2dyb3VuZD0iI2ZiNTQ0ZCIgY2xhc3M9ImNlbnRlciBlbXBoYXNpcyI+CiAgPHA+VmFsZyAzOjwvcD4KICA8aDE+RiMgUmVjb3JkIFR5cGVzPC9oMT4KICA8YXNpZGUgY2xhc3M9Im5vdGVzIj4KICAgIDxwPgogICAgICBWYWxnIHRyZSBlciDDpSBicnVrZSBGIyByZWNvcmQgdHlwZXMgZm9yIMOlIHNrcml2ZSB0eXBlZGVmaW5pc2pvbmVyIGZvciBhbGxlCiAgICAgIG1vZGVscyBww6UgYmFja2VuZC4gRiMsIHNvbSBlciBldCBmdW5rc2pvbmVsbHQgc3Byw6VrIHDDpSBzYW1tZSBydW50aW1lIHNvbQogICAgICBDIywgaGFyIGV0IHZlbGRpZyBla3NwcmVzc2l2dCBvZyBrcmFmdGlnIHR5cGVzeXN0ZW0gdmkgw7huc2tlciDDpSBkcmEgbnl0dGUKICAgICAgYXYuCiAgICA8L3A+CiAgPC9hc2lkZT4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CiAgPGgyPkYjIFJlY29yZCBUeXBlczwvaDI+CiAgPHAgY2xhc3M9ImZyYWdtZW50Ij4KICAgIEFsbGUgdHlwZWRlZmluaXNqb25lciBtw6Ugc2tyaXZlcyBpIEYjLgogIDwvcD4KICA8YXNpZGUgY2xhc3M9Im5vdGVzIj4KICAgIDxwPgogICAgICBGb3Igw6Uga3VubmUga29tcG9uZXJlIHR5cGUgZGVmaW5pc2pvbmVyIHPDpSBtw6UgYWxsZSB0eXBlZGVmaW5pc2pvbmVuZSB2w6ZyZQogICAgICBza3JldmV0IGkgRiMuIFDDpSBncnVubiBhdiBpbnRlcm9wIG1lbGxvbSBDIyBvZyBGIyBlciBkZXQgaW5nZW4gZmxlcmUKICAgICAgZsO4bGdlci4KICAgIDwvcD4KICA8L2FzaWRlPgo8L3NlY3Rpb24+Cgo8c2VjdGlvbiBkYXRhLWJhY2tncm91bmQ9IiNmYjU0NGQiIGNsYXNzPSJjZW50ZXIgZW1waGFzaXMiPgogIDxwPlZhbGcgNDo8L3A+CiAgPGgxPkJ1bmRsZSBUcmFuc2Zvcm1lcjwvaDE+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgRGV0IGZqZXJkZSB2YWxnZXQgdmkgc2thbCBzZSBww6UgdmFyIMOlIGJydWtlIEJ1bmRsZSBUcmFuc2Zvcm1lciB0aWwgw6UKICAgICAgaMOlbmR0ZXJlIGZyb250ZW5kIGFzc2V0cy4gQnVuZGxlIFRyYW5zZm9ybWVyIGVyIGVuIHBsdWdpbiB0aWwgLk5FVCBmb3Igw6UKICAgICAgZ2rDuHJlIGVuIGRlbCBhdiBkZSB2YW5saWdzdGUgb3BwZ2F2ZW5lIHJ1bmR0IGZyb250ZW5kIGFzc2V0cy4KICAgIDwvcD4KICA8L2FzaWRlPgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KICA8aDI+QnVuZGxlIFRyYW5zZm9ybWVyPC9oMj4KICA8cCBjbGFzcz0iZnJhZ21lbnQiPgogICAgQWxsIGtvbmZpZ3VyYXNqb24gYXYgYXNzZXQgcGlwZWxpbmUgc2tqZXIgaW5uZW5mb3IgLk5FVCByYW1tZXZlcmtldC4KICA8L3A+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgRGVuIHZpa3RpZ3N0ZSBmw7hsZ2VuIGF2IGRldHRlIHZhbGdldCB2YXIgYXQgYWxsIGtvbmZpZ3VyYXNqb24gYXYgYXNzZXQKICAgICAgcGlwZWxpbmUgc2tqZXIgaW5uZW5mb3IgLk5FVCByYW1tZXZlcmtldC4gRGV0IGJldHlyIGF0IHZpIG3DpSBicnVrZSAuTkVUcwogICAgICDDuGtvc3lzdGVtIGZvciDDpSBmaW5uZSB2ZXJrdMO4eSBvZyB1dHZpa2xlcmVuIG3DpSBoYSBramVubnNrYXAgdGlsIC5ORVQgZm9yIMOlCiAgICAgIGt1bm5lIGdqw7hyZSBlbmRyaW5nZXIuCiAgICA8L3A+CiAgPC9hc2lkZT4KPC9zZWN0aW9uPgoKPHNlY3Rpb24gY2xhc3M9ImxpZ2h0IGNlbnRlciIgZGF0YS1iYWNrZ3JvdW5kPSIjZTRlYmVlIj4KICA8aDE+SHZpbGtlIGZha3RvcmVyIGJsZSA8c3BhbiBjbGFzcz0idXRoZXYiPmF2amfDuHJlbmRlPC9zcGFuPj88L2gxPgogIDxhc2lkZSBjbGFzcz0ibm90ZXMiPgogICAgPHA+CiAgICAgIEh2aWxrZSBhdiBkaXNzZSB2YWxnZW5lIGZ1bmdlcnRlLCBodmlsa2UgZnVuZ2VydGUgaWtrZT8gSHZpbGtlIGZha3RvcmVyCiAgICAgIGJsZSBhdmdqw7hyZW5kZSBmb3IgcmVzdWx0YXRldD8KICAgIDwvcD4KICAgIDxwPgogICAgICBOb2VuIGhhciBrYW5za2plIGdqZXR0YSByZXN1bHRhdGV0LCBrYW5za2plIGJhc2VydCBww6UgdG9uZWZhbGxldCBvZwogICAgICBpbm5ob2xkZXQgaSBzbGlkZW5lLCBtZW4gZGUgdmFsZ2VuZSBzb20gaWtrZSBoYXIgZnVuZ2VydCBmb3Igb3NzIGhhciB2w6ZydAogICAgICBBbmd1bGFyLmpzIG9nIEJ1bmRsZSBUcmFuc2Zvcm1lci4gTWVucyBGIyByZWNvcmQgdHlwZXMgb2cgc3ByZWFkc2hlZXQKICAgICAgYmFja2VuZCwgaGFyIGZ1bmdlcnQgYnJhLgogICAgPC9wPgogIDwvYXNpZGU+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgogIDxoMT5GQUtUT1JFUjwvaDE+CiAgPHAgY2xhc3M9ImZyYWdtZW50Ij4KICAgIEbDpSBpbm52aXJrbmluZ2VyIHV0b3ZlciDDuG5za2V0IGVmZmVrdC4KICA8L3A+CiAgPGJyIC8+CiAgPHAgY2xhc3M9ImZyYWdtZW50Ij4KICAgIEVua2xlIGFic3RyYWtzam9uZXIuCiAgPC9wPgogIDxhc2lkZSBjbGFzcz0ibm90ZXMiPgogICAgPHA+CiAgICAgIERlbiBmw7hyc3RlIGVnZW5za2FwZW4gc29tIGRlIGdvZGUgdmFsZ2VuZSBoYWRkZSB2YXIgYXQgZGUgaGFkZGUgZsOlCiAgICAgIHJpbmd2aXJrbmluZ2VyIHV0b3ZlciBha2t1cmF0IGRlbiDDuG5za2VkZSBlZmZla3Rlbi4KICAgIDwvcD4KICAgIDxwPgogICAgICBBbmd1bGFyIGRpcmVjdGl2ZXMgaGFkZGUgZW4gZWtzdHJhIHJpbmd2aXJrbmluZ2VyIGkgZm9ybSBhdiBrcmF2IHRpbAogICAgICBtw6V0ZW4gcmVzdGVuIGF2IGdyZW5zZXNuaXR0a29kZW4gYmxlIHNrcmV2ZXQgcMOlLCB2aSBrdW5uZSBpa2tlIGJhcmUgYnJ1a2UKICAgICAgZGlyZWN0aXZlcyBhcyBpcy4gTWVucyBzcHJlYWRzaGVldCBzb20gYmFja2VuZCBoYWRkZSB2ZWxkaWcgZsOlCiAgICAgIHJpbmd2aXJrbmluZ2VyLiBEZW4gZW5lc3RlIHJpbmd2aXJrbmluZ2VuIHZhciBhdCB2aSBtw6V0dGUgb3ZlcnNldHRlCiAgICAgIGRhdGFlbmUgdGlsIGV0IGFubmV0IGZvcm1hdCBmb3Igw6UgYnJ1a2UgZGVtIHZpZGVyZSwgb2cgdGFidWzDpnJlIGRhdGEgbGFyCiAgICAgIHNlZyBnYW5za2UgZW5rZWx0IG92ZXJzZXR0ZXMuCiAgICA8L3A+CiAgICA8cD4KICAgICAgRGVuIGFuZHJlIGVnZW5za2FwZW4gdmFyIGF0IGFic3RyYWtzam9uZW4gdmFyIGVua2VsLiBFbmtlbCBlciBub2UgdmVsZGlnCiAgICAgIGFubmV0IGVubiBsZXR0LiBMZXR0IGVyIGV0IHN1Ympla3RpdiBtw6VsLiBOb2UgZHUga2FuIGZyYSBmw7hyIGVyIGxldHQsCiAgICAgIGZla3MuIEVua2VsdCBlciBldCBvYmpla3RpdnQgbcOlbCBww6Uga29tcGxla3NpdGV0c2dyYWQuCiAgICA8L3A+CiAgICA8cD4KICAgICAgR3J1bm5lbiB0aWwgYXQgRiMgcmVjb3JkIHR5cGVzIGZ1bmdlcnRlIGJyYSB2YXIgYXQgYWJzdHJha3Nqb25lbiB2YXIKICAgICAgdmVsZGlnIG7DpnJtZSBkZXQgZmFrdGlza2UgZGF0YWdydW5ubGFnZXQsIGRlbiB2YXIgZW5rZWwuIEJ1bmRsZQogICAgICBUcmFuc2Zvcm1lciwgcMOlIGRlbiBhbmRyZSBow6VuZCwgaWtrZSBmdW5nZXJ0ZSB2YXIgYXQgZGV0dGUgdmFyIGVuIGxldHQKICAgICAgYWJzdHJha3Nqb24uIEZvciBub2VuIHNvbSBrYW4gLk5FVCB2YXIgZGVuIGxldHQgw6UgYnJ1a2UsIG1lbiBuw6VyIG1hbiBpa2tlCiAgICAgIGthbiAuTkVUIGZyYSBmw7hyIHPDpSBlciBkZXQgaWtrZSBsZW5ncmUgbGV0dC4KICAgIDwvcD4KICA8L2FzaWRlPgo8L3NlY3Rpb24+Cgo8c2VjdGlvbiBkYXRhLWJhY2tncm91bmQ9IiNmYjU0NGQiIGNsYXNzPSJjZW50ZXIgZW1waGFzaXMiPgogIDxoMj5Iw7h5IGVuZHJpbmdzZnJla3ZlbnMgb2cgbXllIHVzaWtrZXJoZXQ8L2gyPgogIDxhc2lkZSBjbGFzcz0ibm90ZXMiPgogICAgPHA+CiAgICAgIEtsaW1hZXQgcHJvc2pla3RldCBiZWZpbm5lciBzZWcgaSBlciBwcmVnZXQgYXYgaMO4eSBlbmRyaW5nc2ZyZWt2ZW5zIG9nIG15ZQogICAgICB1c2lra2VyaGV0IHJ1bmR0IGh2b3JkYW4gbMO4c25pbmduZSBza2FsIGltcGxlbWVudGVyZXMuIERhIGJsaXIgZGV0IGVrc3RyYQogICAgICB2aXRraWcgw6UgaWtrZSB0YSBhdmdqw7hyZWxzZXIgc29tIHZpbCBmw6UgdWhlbGRpZ2UgZsO4bGdlciBpIGVuIGZyZW10aWQgdmkKICAgICAgaWtrZSB2ZXQgc8OlIHZlbGRpZyBteWUgb20uCiAgICA8L3A+CiAgICA8cD4KICAgICAgTGV0dGUgdmFsZyBoYXIgYWxsdGlkIGVuIGtvc3RuYWQgZm9yYnVuZGV0IG1lZCBzZWcuIER1IGJldGFsZXIgaSBmb3JtIGF2CiAgICAgIGZvcnV0c2V0bmluZ2VyIHNvbSBtw6Ugb3BwZnlsbGVzIGZvciBhdCB2YWxnZXQgc2thbCBmdW5nZXJlIG9wdGltYWx0LiBOw6VyCiAgICAgIHZpIG9wZXJlcmVyIG1lZCBow7h5IHVzaWtrZXJoZXQgdmV0IHZpIGlra2Ugb20gZm9ydXRzZXRuaW5nZW5lIHZpIGhhcgogICAgICBha3NlcHRlcnQgc29tIGbDuGxnZSBhdiBldCBlbmtlbHQgdmFsZyBob2xkZXIgZXR0ZXJodmVydCBzb20gdmkgZsOlciBtZXIKICAgICAga3VubnNrYXAgb20gcHJvYmxlbXN0aWxsaW5nZW4uCiAgICA8L3A+CiAgPC9hc2lkZT4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CiAgPGgxPkVOS0xFIFZBTEc8L2gxPgogIDxwIGNsYXNzPSJmcmFnbWVudCI+CiAgICBGb3JldHJla2sgc3Blc2lmaWtlIGzDuHNuaW5nZXIgcMOlIHByb2JsZW1lciBkdSBoYXIuCiAgPC9wPgogIDxiciAvPgogIDxwIGNsYXNzPSJmcmFnbWVudCI+CiAgICBGb3JldHJla2sgZW5rbGUgbMO4c25pbmdlciBvdmVyIGxldHRlIGzDuHNuaW5nZXIuCiAgPC9wPgogIDxhc2lkZSBjbGFzcz0ibm90ZXMiPgogICAgPHA+CiAgICAgIEtvbnNla3ZlbnNlbiBhdiBlcmZhcmluZ2VuZSBkZXQgc2lzdGUgw6VyZXQgZXIgYXQgdmkgw7huc2tlciDDpSB0YSBlbmtsZSB2YWxnCiAgICAgIGZyZW1vdmVyLiBGb3Igw6Ugb3BwbsOlIGRldCBoYXIgdmkgYWRvcHRlcnQgZXQgcGFyIHJldG5pbmdzbGluamVyIGZvciBtw6V0ZW4KICAgICAgdmkgw7huc2tlciDDpSB0YSBhdmdqw7hyZWxzZXIgcMOlLgogICAgPC9wPgogICAgPHA+CiAgICAgIFZpIHZpbCBmb3JldHJla2tlIHNwZXNpZmlrZSBsw7hzbmluZ2VyIHDDpSBwcm9ibGVtIHZpIHZldCB2aSBoYXIuIFZpIHNrYWwKICAgICAgaWtrZSBwcsO4dmUgw6UgdsOmcmUgc21hcnRlIG1lZCBiZWhvdmVuZSB2aSBmw6VyIGkgZnJlbXRpZGVuLiBVc2lra2VyaGV0ZW4gb2cKICAgICAgZW5kcmluZ3NmcmVrdmVuc2VuIGVyIGZvciBzdG9yIHRpbCDDpSB0YSB2YWxnIG9wdGltYWxpc2VydCBmb3IgZW4KICAgICAgaHlwb3RldGlzayBmcmVtdGlkLgogICAgPC9wPgogICAgPHA+CiAgICAgIFZpIHZpbCBmb3JldHJla2tlIGVua2xlIGzDuHNuaW5nZXIgb3ZlciBsZXR0ZSBsw7hzbmluZ2VyLiBFbmtsZSBsw7hzbmluZ2VyCiAgICAgIGdqw7hyIGRldCBsZXR0ZXJlIMOlIGVuZHJlIGt1cnMgZWxsZXIgZ2rDuHJlIGzDuHNuaW5nZW4gbWVyIG9wdGltYWwgZm9yCiAgICAgIHByb2JsZW1zdGlsbGluZ2VuLiBFbiBsZXR0dmludCBsw7hzbmluZyBnaXIga2Fuc2tqZSBlbiBwcm9kdWt0aXZpdGV0c2Jvb3N0CiAgICAgIGkgw7h5ZWJsaWtrZXQsIG1lbiBldHRlcmh2ZXJ0IHNvbSBwcm9ibGVtc3RpbGxpbmdlbiBibGlyIHR5ZGxpZ2VyZSB2aWwKICAgICAgZm9ydXRzZXRuaW5nZW5lIGV0IGxldHQgdmFsZyBzZXR0ZXIgaWtrZSBsZW5ncmUgdsOmcmUgb3BwZnlsbHRlLiBEYSBnw6VyIGRldAogICAgICBsZXR0ZSBvdmVyIHRpbCDDpSB2w6ZyZSB0dW5ndmlubnQuCiAgICA8L3A+CiAgICA8cD4KICAgICAgRXQgc21pZGlnIG1hbnRyYSBlciAiZG8gdGhlIHNpbXBsZXN0IHRoaW5nIHRoYXQgY291bGQgcG9zc2libHkgd29yayIuIFDDpQogICAgICBub3JzayBibGlyIHNpbXBsZSB0aWwgZW5rZWx0LCBpa2tlIHRpbCBsZXR0LiBPZyBsZXR0IGVyIGlra2UgYWxsdGlkIGVua2VsdC4KICAgIDwvcD4KICA8L2FzaWRlPgo8L3NlY3Rpb24+Cgo8c2VjdGlvbiBjbGFzcz0ibGlnaHQgY2VudGVyIiBkYXRhLWJhY2tncm91bmQ9IiNlNGViZWUiPgogIDxoMj5EZXQgZXIgZW5rbGVyZSDDpSBnw6UgZnJhIDxzcGFuIGNsYXNzPSJ1dGhldiI+bWFuZ2VsPC9zcGFuPiBww6UgYWJzdHJha3Nqb24sIGVubiBmcmEgPHNwYW4gY2xhc3M9InV0aGV2Ij5mZWlsPC9zcGFuPiBhYnN0cmFrc2pvbi48L2gyPgogIDxhc2lkZSBjbGFzcz0ibm90ZXMiPgogICAgPHA+CiAgICAgIERldCBlciBlbmtsZXJlIMOlIGfDpSBmcmEgbWFuZ2VsIHDDpSBhYnN0cmFrc2pvbiwgZW5uIGZyYSBmZWlsIGFic3RyYWtzam9uLgogICAgICBJa2tlIHRhIG9tZmF0dGVuZGUgYXZnasO4cmVzbGVyIHDDpSBtYW5nZWxmdWxsdCBncnVubmxhZywgdGEgaGVsbGVyIGVua2xlCiAgICAgIHZhbGcgbWVkIGbDpSByaW5ndmlya25pbmdlciBvZyBieWdnIGlua3JlbWVudGVsbHQuCiAgICA8L3A+CiAgPC9hc2lkZT4KPC9zZWN0aW9uPgoKPHNlY3Rpb24gY2xhc3M9ImNlbnRlciI+CiAgPGgxPlRBS0sgRk9SIE1FRzwvaDE+CiAgPHA+U3RpYW4gVmV1bSBNw7hsbGVyc2VuIC8gQG1vbGxlcnNlPC9wPgo8L3NlY3Rpb24+Cg==","base64");
var title = 'Smidig 2014';

document.querySelector('.slides').innerHTML = slides;
document.querySelector('title').text = title;

}).call(this,require("buffer").Buffer)
},{"buffer":1}]},{},[4]);
