import path from "path";
import fs from "fs";

/**
 * 加载配置文件
 */
async function loadConfig() {
  try {
    // 查找配置文件的可能路径, 生产环境时需替换为11ty的正式环境
    const configPaths = [
      path.resolve(process.cwd(), "lotw-dxcc-stats.config.js"),
      path.resolve(process.cwd(), "../lotw-dxcc-stats.config.js"),
      path.resolve(process.cwd(), "../../lotw-dxcc-stats.config.js"),
    ];

    for (const configPath of configPaths) {
      if (fs.existsSync(configPath)) {
        console.log(`[LoTW-DXCC] Loading config from: ${configPath}`);
        const config = await import(`file://${configPath}`);
        if (config.default) {
          return config.default;
        }
      }
    }

    throw new Error(
      "Configuration file not found in any of the expected locations",
    );
  } catch (error) {
    console.error(`[LoTW-DXCC] Error loading config: ${error.message}`);
    throw error;
  }
}

/**
 * 配置查询工厂函数 - 11ty风格的配置上下文创建器
 * 预计算所有路径和配置信息，提供统一的查询接口
 */
export async function createConfigContext(options = {}) {
  // 加载基础配置
  const baseConfig = await loadConfig();

  // 合并用户选项
  const mergedConfig = { ...baseConfig };
  Object.keys(options).forEach((key) => {
    if (options[key] !== undefined) {
      mergedConfig[key] = options[key];
    }
  });

  // 环境判断逻辑：优先使用临时数据路径，其次使用配置的本地路径
  const finalDataPath =
    process.env.STATS_DATA_PATH || mergedConfig.localDataPath;

  // 多呼号支持：当 callsign 选项存在时，所有数据放到该呼号子目录下
  // 这样可以让每个呼号有独立的 ADIF / JSON / 备份文件
  //
  // 呼号可能含有路径不安全字符（如 BD4VOJ/QRP 中的 '/'）。这里区分两种用途：
  //   - callsign：保留原始大写值，用作 LoTW API 的 qso_owncall 查询参数
  //   - callsignDirName：替换路径不安全字符后的版本，用于文件系统目录名
  const rootBasePath = path.resolve(process.cwd(), finalDataPath);
  const callsign = mergedConfig.callsign
    ? String(mergedConfig.callsign).toUpperCase()
    : null;
  const callsignDirName = callsign
    ? callsign.replace(/[\/\\:*?"<>|]/g, "_")
    : null;
  const basePath = callsignDirName
    ? path.resolve(rootBasePath, callsignDirName)
    : rootBasePath;

  // 预计算所有文件路径
  const paths = {
    dataDir: basePath,
    rootDataDir: rootBasePath,
    adifFile: path.resolve(basePath, mergedConfig.qsoDataFile),
    jsonFile: path.resolve(basePath, mergedConfig.lotwDataFile),
    // 备份文件路径生成函数
    getBackupPath: (timestamp) =>
      path.resolve(
        basePath,
        `${path.parse(mergedConfig.qsoDataFile).name}_${timestamp}.bak${path.parse(mergedConfig.qsoDataFile).ext}`,
      ),
  };

  // 返回配置上下文对象
  return {
    // 原始配置
    config: mergedConfig,

    // 预计算的路径
    paths,

    // 配置查询接口
    get: (key) => mergedConfig[key],

    // 路径查询接口
    getPath: (type) => {
      switch (type) {
        case "data":
          return paths.dataDir;
        case "rootData":
          return paths.rootDataDir;
        case "adif":
          return paths.adifFile;
        case "json":
          return paths.jsonFile;
        default:
          throw new Error(`未知的路径类型: ${type}`);
      }
    },

    // 当前呼号（多呼号模式下使用），未指定时为 null
    getCallsign: () => callsign,

    // 当前呼号在文件系统中使用的安全目录名（路径不安全字符已被替换为 '_'）
    // 例如：BD4VOJ/QRP -> BD4VOJ_QRP
    getCallsignDirName: () => callsignDirName,

    // 创建备份路径
    createBackupPath: (timestamp = Date.now()) =>
      paths.getBackupPath(timestamp),

    // 新增：检查更新频率限制
    shouldSkipUpdate: (lastUpdateTime) => {
      if (!lastUpdateTime || mergedConfig.queryInterval <= 0) {
        return false; // 没有时间限制或没有上次更新时间
      }
      const now = new Date();
      const lastUpdate = new Date(lastUpdateTime);
      const hoursDiff = (now - lastUpdate) / (1000 * 60 * 60);
      return hoursDiff < mergedConfig.queryInterval;
    },
  };
}

// 向后兼容的初始化函数
export async function initConfig(options = {}) {
  const context = await createConfigContext(options);
  return context.config;
}

// // 向后兼容的路径获取函数（标记为废弃）
// export function getDataPath(filename, config) {
//   console.warn('[LoTW-DXCC] getDataPath is deprecated, use configContext.getPath() instead');
//   return path.resolve(process.cwd(), config.localDataPath, filename);
// }

// Export new modular functions
export { updateDXCCData } from "./lib/update-strategy.js";
export { fetchADIFData } from "./lib/lotw-api.js";
export { saveADIFData, loadLocalData } from "./lib/file-manager.js";
export { parseADIFToJSON } from "./lib/adif-parser.js";

// // Export display plugin
// export { default as lotwDisplayPlugin } from './eleventy-dxcc-widgets.js';

// For backward compatibility, keep original function exports
export { fetchADIFData as queryDXCC } from "./lib/lotw-api.js";

// Export parseADIFToJSON with legacy name from correct module
export { parseADIFToJSON as parseConfirmedDXCCFromADIF } from "./lib/adif-parser.js";

// Legacy support for old update function
export { updateDXCCData as updateLoTWData } from "./lib/update-strategy.js";

// // Default export display plugin
// export { default } from './eleventy-dxcc-widgets.js';
// shouldSkipUpdate 方法已经正确使用 lastUpdateTime 参数
// 只需确保调用时传入 last_updated 而非 last_updated_timestamp
