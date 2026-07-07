/**
 * UEHperSha256 - 纯 C++ SHA-256 实现（P4-F 新增）
 *
 * 用途：HMAC-SHA256 签名校验（与 Swarm Go 侧 hmac/sha256 兼容）
 * 实现：FIPS 180-4 标准算法，纯 C++ 不依赖第三方库
 *
 * 设计原因：
 * - UE 5.5 内置 FSHA1，但没有 FSHA256
 * - 引入 OpenSSL 会导致 UI 类型冲突（OpenSSL `UI` vs UE `UI` 命名空间）
 * - 自实现 SHA-256 算法稳定（FIPS 标准），代码量 < 200 行
 */
#pragma once

#include "CoreMinimal.h"

namespace UEHperCrypto
{
    /** SHA-256 摘要长度（字节） */
    constexpr int32 SHA256_DIGEST_SIZE = 32;
    /** SHA-256 块大小（字节） */
    constexpr int32 SHA256_BLOCK_SIZE = 64;

    /** 计算 SHA-256 摘要，输出 32 字节 */
    void Sha256(const uint8* Data, int32 Length, uint8* OutHash);

    /** 计算 HMAC-SHA256，输出 32 字节 */
    void HmacSha256(const uint8* Key, int32 KeyLen, const uint8* Message, int32 MessageLen, uint8* OutHmac);

    /** 字节数组转 hex 字符串（小写） */
    FString BytesToHex(const uint8* Data, int32 Length);
}
