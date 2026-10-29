function InventoryReadError({ loading, onRetry }) {
  return (
    <div className="card space-y-3 border border-rose-200 bg-rose-50">
      <p role="alert" className="text-sm leading-6 text-rose-700">
        재고를 불러오지 못했어요. 재고가 비어 있는지 아직 확인할 수 없어요.
      </p>
      <button className="btn-secondary" type="button" disabled={loading}
        onClick={() => { onRetry({ force: true }).catch(() => {}); }}>
        {loading ? '재고 확인 중...' : '재고 다시 불러오기'}
      </button>
    </div>
  );
}

export default InventoryReadError;
