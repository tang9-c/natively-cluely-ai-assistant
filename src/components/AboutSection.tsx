import React from "react";
import { Mail, MicOff, Shield } from "lucide-react";

interface AboutSectionProps {}

export const AboutSection: React.FC<AboutSectionProps> = () => {
  const handleOpenLink = (
    e: React.MouseEvent<HTMLAnchorElement>,
    url: string,
  ) => {
    e.preventDefault();

    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url);
    } else {
      window.open(url, "_blank");
    }
  };

  return (
    <div className="space-y-6 animated fadeIn pb-10">
      {/* Header */}
      <div>
        <h3 className="text-lg font-bold text-text-primary mb-1">
          关于 Natively
        </h3>
        <p className="text-sm text-text-secondary">
          Designed to be invisible, intelligent, and trusted.
        </p>
        <p className="text-xs text-text-tertiary mt-2 leading-relaxed">
          本项目 fork 自{" "}
          <a
            href="https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant"
            onClick={(e) =>
              handleOpenLink(
                e,
                "https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant",
              )
            }
            className="text-accent-primary hover:underline"
          >
            github.com/Natively-AI-assistant/natively-cluely-ai-assistant
          </a>
          ,并基于 AGPL-3.0 协议继续发布。源代码、修改记录与许可证请参见原仓库。
        </p>
      </div>

      {/* Privacy Section */}
      <div>
        <h4 className="text-xs font-bold text-text-tertiary uppercase tracking-wider mb-2 px-1">
          隐私与数据
        </h4>
        <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5 space-y-4">
          <div className="flex items-start gap-3">
            <Shield size={16} className="text-green-400 mt-0.5" />
            <div>
              <h5 className="text-sm font-medium text-text-primary">
                隐私控制
              </h5>
              <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                你可以精确控制哪些数据会离开你的设备。
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MicOff size={16} className="text-red-500 mt-0.5" />
            <div>
              <h5 className="text-sm font-medium text-text-primary">未录制</h5>
              <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                Natively
                仅在启用时监听。它不会录制视频，不会在没有指令的情况下任意截图，也不会进行后台监控。
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Contact */}
      <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 shadow-sm shadow-blue-500/5">
            <Mail size={18} className="opacity-80" />
          </div>
          <div>
            <h5 className="text-sm font-bold text-text-primary">联系我们</h5>
            <p className="text-xs text-text-secondary mt-0.5">
              Open for professional collaborations and job offers.
            </p>
          </div>
        </div>
        <a
          href="mailto:tangdu@feigenbaum.ai"
          onClick={(e) => handleOpenLink(e, "mailto:tangdu@feigenbaum.ai")}
          className="whitespace-nowrap px-4 py-2 bg-text-primary hover:bg-white/90 text-bg-main text-xs font-bold rounded-lg transition-all shadow hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 flex items-center gap-2"
        >
          <Mail size={14} />
          Contact Me
        </a>
      </div>
    </div>
  );
};
