import Swal from 'sweetalert2';

/** 确认框。下载对话框的层级很高，这里把 SweetAlert 的容器提到它们之上 */
export async function confirmAction(options: {
  title: string;
  text: string;
  confirmText: string;
  cancelText: string;
}): Promise<boolean> {
  const { isConfirmed } = await Swal.fire({
    title: options.title,
    text: options.text,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: options.confirmText,
    cancelButtonText: options.cancelText,
    focusCancel: true,
    didOpen: () => {
      const container = Swal.getContainer();
      if (container) container.style.zIndex = '11000';
    },
  });
  return isConfirmed;
}

/** 右上角的轻提示，可带一个操作按钮 */
export async function toast(options: {
  title: string;
  actionText?: string;
  icon?: 'success' | 'error' | 'info';
}): Promise<boolean> {
  const { isConfirmed } = await Swal.fire({
    toast: true,
    position: 'top-end',
    icon: options.icon ?? 'success',
    title: options.title,
    showConfirmButton: !!options.actionText,
    confirmButtonText: options.actionText,
    timer: 4000,
    timerProgressBar: true,
    didOpen: (el) => {
      const container = Swal.getContainer();
      if (container) container.style.zIndex = '11000';
      el.addEventListener('mouseenter', Swal.stopTimer);
      el.addEventListener('mouseleave', Swal.resumeTimer);
    },
  });
  return isConfirmed;
}
