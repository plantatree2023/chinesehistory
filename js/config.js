// 网站配置（所有数据集共用）。
// feedback：访问者的反馈和修改建议通过 Web3Forms（https://web3forms.com）发送到维护者的邮箱。
//   accessKey 是在 Web3Forms 网站用邮箱免费申请的 Access Key，设计上就可以公开写在网页中（它只能用来向该邮箱发送表单）。
//   accessKey 留空时反馈入口照常显示，但提交时提示“反馈服务尚未配置”，不会发出。
//   enabled 为 false 时不显示任何反馈入口。
window.TIMELINE_CONFIG = {
  feedback: {
    enabled: true,
    endpoint: 'https://api.web3forms.com/submit',
    accessKey: '40efad52-eafe-4100-9e33-935506c7af17'
  }
};
