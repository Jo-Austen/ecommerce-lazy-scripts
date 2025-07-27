"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const block_basekit_server_api_1 = require("@lark-opdev/block-basekit-server-api");
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// 🟢 缓存 Token，避免重复请求
let cachedToken = null;
// 获取飞书访问令牌
async function getAccessToken() {
    if (cachedToken)
        return cachedToken;
    const { APP_ID, APP_SECRET } = process.env;
    if (!APP_ID || !APP_SECRET)
        throw new Error('❌ 缺少 APP_ID 或 APP_SECRET');
    const response = await axios_1.default.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: APP_ID,
        app_secret: APP_SECRET
    });
    cachedToken = response.data?.tenant_access_token;
    if (!cachedToken)
        throw new Error('❌ 获取 Token 失败');
    console.log('✅ 获取到 Token');
    return cachedToken;
}
// 🟡 通用 API 请求函数
async function apiRequest(method, url, data) {
    const token = await getAccessToken();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    try {
        const response = await (0, axios_1.default)({ method, url, headers, data });
        // 判断请求是否成功
        if (response.data?.code === 0 && response.data?.data) {
            console.log(`✅ 请求成功: ${url}`);
            return response.data.data;
        }
        else {
            console.warn(`⚠️ 请求失败: ${url}, 错误信息: ${response.data?.msg || '未知错误'}`);
            return null;
        }
    }
    catch (error) {
        console.error(`❌ 请求异常: ${url}`, error.response?.data || error.message);
        return null;
    }
}
// 🔍 获取物料编码 Record ID
async function getMaterialRecordId(name, spec, unit, price) {
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.TABLE_APP_TOKEN}/tables/${process.env.MATERIAL_TABLE_ID}/records/search`;
    const data = {
        filter: {
            conditions: [
                { field_name: '物料名称', operator: 'is', value: [name] },
                { field_name: '规格型号', operator: 'is', value: [spec] },
                { field_name: '计量单位', operator: 'is', value: [unit] },
                { field_name: '标准单价', operator: 'is', value: [price.toString()] }
            ],
            conjunction: 'and'
        },
        field_names: ['物料编码'],
        page_size: 1
    };
    const result = await apiRequest('POST', url, data);
    const recordId = result?.items?.[0]?.record_id;
    if (!recordId) {
        console.warn(`⚠️ 未找到物料：${name} | ${spec} | ${unit} | ${price}`);
        return null;
    }
    console.log(`✅ 物料编码 Record ID: ${recordId}`);
    return recordId;
}
// 🔑 获取采购单 Record ID
async function getPurchaseRecordId(purchaseId) {
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.TABLE_APP_TOKEN}/tables/${process.env.PURCHASE_TABLE_ID}/records/search`;
    const data = {
        automatic_fields: false,
        field_names: ['申请编号'],
        filter: {
            conditions: [{ field_name: '申请编号', operator: 'is', value: [purchaseId] }],
            conjunction: 'and'
        },
        page_size: 1
    };
    const result = await apiRequest('POST', url, data);
    const recordId = result?.items?.[0]?.record_id;
    if (!recordId) {
        console.warn(`⚠️ 未找到采购单号: ${purchaseId}`);
        return null;
    }
    console.log(`✅ 采购单 Record ID: ${recordId}`);
    return recordId;
}
// ✂️ 拆分采购明细
function splitPurchaseDetails(details) {
    return details.split(';').map(item => {
        const record = {};
        item.split('|').forEach(field => {
            const [key, value] = field.split(':').map(part => part.trim());
            if (key && value)
                record[key] = ['标准单价', '采购价格(元)'].includes(key) ? parseFloat(value) : value;
        });
        return record;
    }).filter(record => record['物料名称'] && record['规格型号'] && record['计量单位'] && record['标准单价']);
}
// 📝 创建明细表记录
async function createDetailRecord(purchaseId, detail) {
    const materialRecordId = await getMaterialRecordId(detail['物料名称'], detail['规格型号'], detail['计量单位'], Number(detail['标准单价']));
    if (!materialRecordId) {
        console.warn(`⚠️ 未找到对应物料，跳过写入：${JSON.stringify(detail)}`);
        return;
    }
    const purchaseRecordId = await getPurchaseRecordId(purchaseId);
    if (!purchaseRecordId)
        throw new Error(`❌ 未找到采购单号 ${purchaseId}`);
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.TABLE_APP_TOKEN}/tables/${process.env.DETAIL_TABLE_ID}/records`;
    const payload = {
        fields: {
            '采购单号': [purchaseRecordId],
            '物料名称': detail['物料名称'],
            '规格型号': detail['规格型号'],
            '计量单位': detail['计量单位'],
            '标准单价': Number(detail['标准单价']) || 0,
            '采购价格(元)': Number(detail['采购价格(元)']) || 0,
            '物料编码': [materialRecordId]
        }
    };
    await apiRequest('POST', url, payload);
    console.log(`✅ 明细写入成功: ${detail['物料名称']}`);
}
// 🚀 注册插件
block_basekit_server_api_1.basekit.addAction({
    formItems: [
        { itemId: 'purchaseId', label: '采购单号', required: true, component: block_basekit_server_api_1.Component.Input },
        { itemId: 'purchaseDetails', label: '采购明细', required: true, component: block_basekit_server_api_1.Component.Input }
    ],
    execute: async (args) => {
        const { purchaseId, purchaseDetails } = args;
        if (!purchaseId || !purchaseDetails)
            throw new Error('❌ 采购单号和采购明细不能为空');
        const items = splitPurchaseDetails(purchaseDetails);
        if (items.length === 0)
            throw new Error('❌ 未检测到有效的采购明细');
        let successCount = 0;
        for (const item of items) {
            try {
                await createDetailRecord(purchaseId, item);
                successCount++; // 只有成功写入时增加计数
            }
            catch (error) {
                console.warn(`⚠️ 跳过未写入的记录：${JSON.stringify(item)}`);
            }
        }
        return { success: true, message: `✅ 成功写入 ${successCount} 条明细` };
    },
    resultType: {
        type: block_basekit_server_api_1.ParamType.Object,
        properties: {
            success: { type: block_basekit_server_api_1.ParamType.Boolean, label: '执行状态' },
            message: { type: block_basekit_server_api_1.ParamType.String, label: '结果信息' }
        }
    }
});
exports.default = block_basekit_server_api_1.basekit;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVnaXN0ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJyZWdpc3Rlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7OztBQUFBLG1GQUFxRjtBQUNyRixrREFBMEI7QUFDMUIsb0RBQTRCO0FBRTVCLGdCQUFNLENBQUMsTUFBTSxFQUFFLENBQUM7QUFFaEIscUJBQXFCO0FBQ3JCLElBQUksV0FBVyxHQUFrQixJQUFJLENBQUM7QUFFdEMsV0FBVztBQUNYLEtBQUssVUFBVSxjQUFjO0lBQ3pCLElBQUksV0FBVztRQUFFLE9BQU8sV0FBVyxDQUFDO0lBRXBDLE1BQU0sRUFBRSxNQUFNLEVBQUUsVUFBVSxFQUFFLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQztJQUMzQyxJQUFJLENBQUMsTUFBTSxJQUFJLENBQUMsVUFBVTtRQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsMEJBQTBCLENBQUMsQ0FBQztJQUV4RSxNQUFNLFFBQVEsR0FBRyxNQUFNLGVBQUssQ0FBQyxJQUFJLENBQUMsdUVBQXVFLEVBQUU7UUFDdkcsTUFBTSxFQUFFLE1BQU07UUFDZCxVQUFVLEVBQUUsVUFBVTtLQUN6QixDQUFDLENBQUM7SUFFSCxXQUFXLEdBQUcsUUFBUSxDQUFDLElBQUksRUFBRSxtQkFBbUIsQ0FBQztJQUNqRCxJQUFJLENBQUMsV0FBVztRQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsZUFBZSxDQUFDLENBQUM7SUFFbkQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQztJQUMzQixPQUFPLFdBQVcsQ0FBQztBQUN2QixDQUFDO0FBRUQsaUJBQWlCO0FBQ2pCLEtBQUssVUFBVSxVQUFVLENBQUMsTUFBc0IsRUFBRSxHQUFXLEVBQUUsSUFBVTtJQUN2RSxNQUFNLEtBQUssR0FBRyxNQUFNLGNBQWMsRUFBRSxDQUFDO0lBQ3JDLE1BQU0sT0FBTyxHQUFHLEVBQUUsYUFBYSxFQUFFLFVBQVUsS0FBSyxFQUFFLEVBQUUsY0FBYyxFQUFFLGtCQUFrQixF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