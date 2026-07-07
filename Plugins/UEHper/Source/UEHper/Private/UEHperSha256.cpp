/**
 * UEHperSha256 - 纯 C++ SHA-256 + HMAC-SHA256 实现（P4-F 新增）
 *
 * 标准：FIPS 180-4 SHA-256 + RFC 2104 HMAC
 * 兼容：与 Swarm Go 侧 crypto/hmac + crypto/sha256 输出一致
 */
#include "UEHperSha256.h"

namespace UEHperCrypto
{
    // SHA-256 常量 K (FIPS 180-4 §4.2.2)
    static const uint32 K[64] = {
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    };

    // 初始哈希值 H (FIPS 180-4 §5.3.3)
    static const uint32 H0[8] = {
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    };

    static inline uint32 RotR(uint32 X, int32 N) { return (X >> N) | (X << (32 - N)); }

    static void Sha256Transform(uint32 State[8], const uint8 Block[64])
    {
        uint32 W[64];
        for (int32 i = 0; i < 16; i++)
        {
            W[i] = ((uint32)Block[i * 4] << 24) | ((uint32)Block[i * 4 + 1] << 16) |
                   ((uint32)Block[i * 4 + 2] << 8) | ((uint32)Block[i * 4 + 3]);
        }
        for (int32 i = 16; i < 64; i++)
        {
            uint32 S0 = RotR(W[i - 15], 7) ^ RotR(W[i - 15], 18) ^ (W[i - 15] >> 3);
            uint32 S1 = RotR(W[i - 2], 17) ^ RotR(W[i - 2], 19) ^ (W[i - 2] >> 10);
            W[i] = W[i - 16] + S0 + W[i - 7] + S1;
        }

        uint32 A = State[0], B = State[1], C = State[2], D = State[3];
        uint32 E = State[4], F = State[5], G = State[6], H = State[7];

        for (int32 i = 0; i < 64; i++)
        {
            uint32 S1 = RotR(E, 6) ^ RotR(E, 11) ^ RotR(E, 25);
            uint32 Ch = (E & F) ^ (~E & G);
            uint32 T1 = H + S1 + Ch + K[i] + W[i];
            uint32 S0 = RotR(A, 2) ^ RotR(A, 13) ^ RotR(A, 22);
            uint32 Maj = (A & B) ^ (A & C) ^ (B & C);
            uint32 T2 = S0 + Maj;
            H = G; G = F; F = E; E = D + T1;
            D = C; C = B; B = A; A = T1 + T2;
        }

        State[0] += A; State[1] += B; State[2] += C; State[3] += D;
        State[4] += E; State[5] += F; State[6] += G; State[7] += H;
    }

    void Sha256(const uint8* Data, int32 Length, uint8* OutHash)
    {
        uint32 State[8];
        FMemory::Memcpy(State, H0, sizeof(H0));

        // 处理完整块
        int32 i = 0;
        while (Length - i >= 64)
        {
            Sha256Transform(State, Data + i);
            i += 64;
        }

        // 处理最后一块：填充
        uint8 LastBlock[128] = { 0 };
        const int32 RemainBytes = Length - i;
        FMemory::Memcpy(LastBlock, Data + i, RemainBytes);
        LastBlock[RemainBytes] = 0x80;

        int32 PadEnd = RemainBytes + 1;
        if (PadEnd > 56)
        {
            // 需要两块
            Sha256Transform(State, LastBlock);
            FMemory::Memset(LastBlock, 0, 64);
            PadEnd = 0;
        }

        // 最后 8 字节：消息位长度（大端）
        const uint64 BitLength = (uint64)Length * 8;
        for (int32 j = 0; j < 8; j++)
        {
            LastBlock[56 + j] = (uint8)((BitLength >> ((7 - j) * 8)) & 0xff);
        }
        Sha256Transform(State, LastBlock);

        // 输出大端字节序
        for (int32 j = 0; j < 8; j++)
        {
            OutHash[j * 4] = (uint8)(State[j] >> 24);
            OutHash[j * 4 + 1] = (uint8)(State[j] >> 16);
            OutHash[j * 4 + 2] = (uint8)(State[j] >> 8);
            OutHash[j * 4 + 3] = (uint8)(State[j]);
        }
    }

    void HmacSha256(const uint8* Key, int32 KeyLen, const uint8* Message, int32 MessageLen, uint8* OutHmac)
    {
        // RFC 2104: HMAC(K, m) = SHA256((K^opad) || SHA256((K^ipad) || m))
        uint8 KeyBuffer[SHA256_BLOCK_SIZE] = { 0 };

        if (KeyLen > SHA256_BLOCK_SIZE)
        {
            // 密钥超长，先 SHA256 缩短
            Sha256(Key, KeyLen, KeyBuffer);
        }
        else
        {
            FMemory::Memcpy(KeyBuffer, Key, KeyLen);
        }

        uint8 IPad[SHA256_BLOCK_SIZE];
        uint8 OPad[SHA256_BLOCK_SIZE];
        for (int32 i = 0; i < SHA256_BLOCK_SIZE; i++)
        {
            IPad[i] = KeyBuffer[i] ^ 0x36;
            OPad[i] = KeyBuffer[i] ^ 0x5c;
        }

        // 内层 SHA256(IPad || Message)
        TArray<uint8> Inner;
        Inner.SetNumUninitialized(SHA256_BLOCK_SIZE + MessageLen);
        FMemory::Memcpy(Inner.GetData(), IPad, SHA256_BLOCK_SIZE);
        FMemory::Memcpy(Inner.GetData() + SHA256_BLOCK_SIZE, Message, MessageLen);
        uint8 InnerHash[SHA256_DIGEST_SIZE];
        Sha256(Inner.GetData(), Inner.Num(), InnerHash);

        // 外层 SHA256(OPad || InnerHash)
        uint8 OuterInput[SHA256_BLOCK_SIZE + SHA256_DIGEST_SIZE];
        FMemory::Memcpy(OuterInput, OPad, SHA256_BLOCK_SIZE);
        FMemory::Memcpy(OuterInput + SHA256_BLOCK_SIZE, InnerHash, SHA256_DIGEST_SIZE);
        Sha256(OuterInput, sizeof(OuterInput), OutHmac);
    }

    FString BytesToHex(const uint8* Data, int32 Length)
    {
        FString Result;
        Result.Reserve(Length * 2);
        const TCHAR HexChars[] = TEXT("0123456789abcdef");
        for (int32 i = 0; i < Length; i++)
        {
            Result.AppendChar(HexChars[(Data[i] >> 4) & 0xf]);
            Result.AppendChar(HexChars[Data[i] & 0xf]);
        }
        return Result;
    }
}
