import curl2Json from "@bany/curl-to-json";

export interface CurlValidationResult {
    isValid: boolean;
    message?: string;
    json?: any;
}

export const validateCurl = (curl: string): CurlValidationResult => {
    if (!curl || !curl.trim()) {
        return { isValid: false, message: "命令不能为空。" };
    }

    // Basic check for curl command
    if (!curl.trim().toLowerCase().startsWith("curl")) {
        return {
            isValid: false,
            message: "命令必须以 'curl' 开头。",
        };
    }

    try {
        const json = curl2Json(curl);

        // Check for {{TEXT}} placeholder
        if (!curl.includes("{{TEXT}}")) {
            return {
                isValid: false,
                message: "您的 cURL 必须包含 {{TEXT}} 变量来注入用户消息。"
            };
        }

        return { isValid: true, json };
    } catch (error) {
        return {
            isValid: false,
            message:
                "Invalid cURL command syntax. Please check for typos.",
        };
    }
};
