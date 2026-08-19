const ViewItemDetails: React.FC<{ id: string }> = ({ id }) => {
  return (
    <div>
      <h1>Item Details</h1>
      <p>Item ID: {id}</p>
    </div>
  );
};

export default ViewItemDetails;
