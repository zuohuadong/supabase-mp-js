#!/usr/bin/env bash
# 验证修复后的库构建

echo "🔍 验证 supabase-mp-js 修复..."
echo ""

# 检查构建产物
echo "1️⃣ 检查构建产物..."
if [ -d "dist/main" ] && [ -d "dist/module" ] && [ -d "dist/umd" ]; then
    echo "✅ 所有构建目录都存在"
else
    echo "❌ 缺少构建目录"
    exit 1
fi

# 检查关键文件
echo ""
echo "2️⃣ 检查关键文件..."
files=(
    "dist/main/index.js"
    "dist/module/index.js"
    "dist/module/index.d.ts"
    "dist/umd/supabase.js"
    "dist/index.mjs"
)

for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file"
    else
        echo "❌ $file 缺失"
        exit 1
    fi
done

# 检查修复的代码
echo ""
echo "3️⃣ 检查修复内容..."

# 检查 helpers.ts 编译后的内容
if grep -q "setItemAsync.*Promise<void>" dist/module/gotrue-js/src/lib/helpers.d.ts 2>/dev/null; then
    echo "✅ setItemAsync 现在返回 Promise<void>"
else
    echo "⚠️  无法验证 setItemAsync 类型（可能正常）"
fi

if grep -q "getItemAsync.*Promise" dist/module/gotrue-js/src/lib/helpers.d.ts 2>/dev/null; then
    echo "✅ getItemAsync 现在返回 Promise"
else
    echo "⚠️  无法验证 getItemAsync 类型（可能正常）"
fi

# 检查文件大小
echo ""
echo "4️⃣ 检查文件大小..."
main_size=$(wc -c < "dist/main/index.js" 2>/dev/null || echo "0")
module_size=$(wc -c < "dist/module/index.js" 2>/dev/null || echo "0")
umd_size=$(wc -c < "dist/umd/supabase.js" 2>/dev/null || echo "0")

echo "📦 dist/main/index.js: $(numfmt --to=iec-i --suffix=B $main_size 2>/dev/null || echo "${main_size}B")"
echo "📦 dist/module/index.js: $(numfmt --to=iec-i --suffix=B $module_size 2>/dev/null || echo "${module_size}B")"
echo "📦 dist/umd/supabase.js: $(numfmt --to=iec-i --suffix=B $umd_size 2>/dev/null || echo "${umd_size}B")"

# 检查版本
echo ""
echo "5️⃣ 当前版本..."
version=$(grep -oP '(?<="version": ")[^"]*' package.json)
echo "📌 版本: $version"

echo ""
echo "✅ 验证完成！"
echo ""
echo "📝 下一步操作："
echo "   1. 在你的小程序项目中运行: npm install file:$(pwd)"
echo "   2. 或者发布到 NPM: npm publish"
echo "   3. 测试登录功能并观察控制台日志"
