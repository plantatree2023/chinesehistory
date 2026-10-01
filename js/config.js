// 网站配置（所有数据集共用）。
// feedback：访问者的反馈和修改建议通过 Web3Forms（https://web3forms.com）发送到维护者的邮箱。
//   accessKey 是在 Web3Forms 网站用邮箱免费申请的 Access Key，设计上就可以公开写在网页中（它只能用来向该邮箱发送表单）。
//   留空时网页不显示任何反馈入口。
window.TIMELINE_CONFIG = {
  feedback: {
    endpoint: 'https://api.web3forms.com/submit',
    accessKey: ''
  }
};
